'use strict';

const eCode = require('../../docs/scripts/floExchangeAPI').errorCode;
const pCode = require('../../docs/scripts/floExchangeAPI').processCode;
const getRate = require('./conversion').getRate;

var DB; //container for database

const bobsFund = (function () {
    const productStr = "Bobs Fund";

    const magnitude = m => {
        switch (m) {
            case "thousand": return 1000;
            case "lakh": case "lakhs": return 100000;
            case "million": return 1000000;
            case "crore": case "crores": return 10000000;
            default: return null;
        }
    }
    const parseNumber = (str) => {
        let n = 0,
            g = 0;
        str.toLowerCase().replace(/,/g, '').split(" ").forEach(s => {
            if (!isNaN(s))
                g = parseFloat(s);
            else {
                let m = magnitude(s);
                if (m !== null) {
                    n += m * g;
                    g = 0;
                }
            }
        });
        return n + g;
    }
    const parsePeriod = (str) => {
        let P = '', n = 0;
        str.toLowerCase().replace(/,/g, '').split(" ").forEach(s => {
            if (!isNaN(s))
                n = parseFloat(s);
            else switch (s) {
                case "year(s)": case "year": case "years": P += (n + 'Y'); n = 0; break;
                case "month(s)": case "month": case "months": P += (n + 'M'); n = 0; break;
                case "day(s)": case "day": case "days": P += (n + 'D'); n = 0; break;
            }
        });
        return P;
    }
    const dateFormat = (date = null) => {
        let d = (date ? new Date(date) : new Date()).toDateString();
        return [d.substring(8, 10), d.substring(4, 7), d.substring(11, 15)].join(" ");
    }

    const dateAdder = function (start_date, duration) {
        let date = new Date(start_date);
        let y = parseInt(duration.match(/\d+Y/)),
            m = parseInt(duration.match(/\d+M/)),
            d = parseInt(duration.match(/\d+D/));
        if (!isNaN(y))
            date.setFullYear(date.getFullYear() + y);
        if (!isNaN(m))
            date.setMonth(date.getMonth() + m);
        if (!isNaN(d))
            date.setDate(date.getDate() + d);
        return date;
    }

    function calcNetValue(BTC_base, BTC_net, USD_base, USD_net, amount, fee) {
        let gain, interest, net;
        gain = (BTC_net - BTC_base) / BTC_base;
        interest = gain * (1 - fee)
        net = amount / USD_base;
        net += net * interest;
        return net * USD_net;
    }

    function stringify_main(BTC_base, USD_base, start_date, duration, investments, fee = 0, tapoutWindow = null, tapoutInterval = null) {
        let result = [
            `${productStr}`,
            `Base Value: ${BTC_base} USD`,
            `USD INR rate at start: ${USD_base}`,
            `Start date: ${dateFormat(start_date)}`,
            `Duration: ${duration}`,
            `Management Fee: ${fee != 0 ? fee + "%" : "0 (Zero)"}`
        ];
        if (tapoutInterval) {
            if (Array.isArray(tapoutInterval)) {
                let x = tapoutInterval.pop(),
                    y = tapoutInterval.join(", ")
                tapoutInterval = `${y} and ${x}`
            }
            result.push(`Tapout availability: ${tapoutWindow} after ${tapoutInterval}`);
        }
        result.push(`Investment(s) (INR): ${investments.map(f => `${f[0].trim()}-${f[1].trim()}`).join("; ")}`);
        return result.join("|");
    }

    function stringify_continue(fundID, investments) {
        return [
            `${productStr}`,
            `continue: ${fundID}`,
            `Investment(s) (INR): ${investments.map(f => `${f[0].trim()}-${f[1].trim()}`).join("; ")}`
        ].join("|");
    }

    function parse_main(data) {
        let funds = {};
        if (!Array.isArray(data))
            data = [data];
        data.forEach(fd => {
            let cont = /continue: [a-z0-9]{64}\|/.test(fd);
            fd.data.split("|").forEach(d => {
                d = d.split(': ');
                switch (d[0].toLowerCase()) {
                    case "start date":
                        cont ? null : funds["start_date"] = d[1]; break;
                    case "base value":
                        cont ? null : funds["BTC_base"] = parseNumber(d[1].slice(0, -4)); break;
                    case "usd inr rate at start":
                        cont ? null : funds["USD_base"] = parseFloat(d[1]); break;
                    case "duration":
                        cont ? null : funds["duration"] = parsePeriod(d[1]); break;
                    case "management fee":
                        cont ? null : funds["fee"] = parseFloat(d[1]); break;
                    case "tapout availability":
                        let x = d[1].toLowerCase().split("after")
                        funds["tapoutInterval"] = x[1].match(/\d+ [a-z]+/gi).map(y => parsePeriod(y))
                        funds["topoutWindow"] = parsePeriod(x[0]); break;
                    case "invesment(s) (inr)":
                    case "investment(s) (inr)":
                        funds["amounts"] = funds["amounts"] || [];
                        funds["amounts"].push(d[1].split("; ").map(a => {
                            a = a.split("-");
                            return [a[0], parseNumber(a[1])]
                        })); break;
                }
            });
        })
        return funds;
    }

    function stringify_end(fund_id, floID, end_date, BTC_net, USD_net, amount, ref_sign, payment_ref) {
        return [
            `${productStr}`,
            `Fund: ${fund_id}`,
            `Investor: ${floID}`,
            `End value: ${BTC_net} USD`,
            `Date of withdrawal: ${end_date}`,
            `USD INR rate at end: ${USD_net}`,
            `Amount withdrawn: Rs ${amount} via ${payment_ref}`,
            `Reference: ${ref_sign}`
        ].join("|");
    }

    function parse_end(data) {
        //Data (end fund) send by market nodes
        let details = {};
        data.split("|").forEach(d => {
            d = d.split(': ');
            switch (d[0].toLowerCase()) {
                case "fund":
                    details["fundID"] = d[1]; break;
                case "investor":
                    details["floID"] = d[1]; break;
                case "end value":
                    details["BTC_net"] = parseNumber(d[1].slice(0, -4)); break;
                case "date of withdrawal":
                    details["endDate"] = new Date(d[1]); break;
                case "amount withdrawn":
                    details["amountFinal"] = parseNumber(d[1].match(/\d.+ via/).toString());
                    details["payment_refRef"] = d[1].match(/via .+/).toString().substring(4); break;
                case "usd inr rate at end":
                    details["USD_net"] = parseFloat(d[1]); break;
                case "reference":
                    details["refSign"] = d[1]; break;
            }
        })
    }


    return {
        dateAdder,
        dateFormat,
        calcNetValue,
        parse: {
            main: parse_main,
            end: parse_end
        },
        stringify: {
            main: stringify_main,
            continue: stringify_continue,
            end: stringify_end
        }
    }

})();

bobsFund.config = {
    adminID: "FFXy5pJnfzu2fCDLhpUremyXQjGtFpgCDN",
    application: "BobsFund"
}

function refreshBlockchainData(nodeList = []) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT num FROM LastTx WHERE floID=?", [bobsFund.config.adminID]).then(result => {
            let lastTx = result.length ? result[0].num : 0;
            floBlockchainAPI.readData(bobsFund.config.adminID, {
                ignoreOld: lastTx,
                senders: [nodeList].concat(bobsFund.config.adminID), //sentOnly: true,
                tx: true,
                filter: d => d.startsWith(bobsFund.config.productStr)
            }).then(result => {
                let promises = [];
                result.data.forEach(d => {
                    let fund = d.senders.has(bobsFund.config.adminID) ? bobsFund.parse.main(d.data) : null;
                    if (fund && fund.amount) {
                        let fund_id = d.data.match(/continue: [a-z0-9]{64}\|/);
                        if (!fund_id) {
                            fund_id = d.txid;
                            let values = [fund_id, fund.start_date, fund.BTC_base, fund.USD_base, fund.fee, fund.duration];
                            if (fund.tapoutInterval)
                                values.push(fund.topoutWindow, fund.tapoutInterval.join(','));
                            promises.push(DB.query(`INSERT INTO BobsFund(fund_id, begin_date, btc_base, usd_base, fee, duration ${fund.tapoutInterval ? ", tapout_window, tapout_interval" : ""}) VALUES ? ON DUPLICATE KEY UPDATE fund_id=fund_id`, [[values]]));
                        } else
                            fund_id = fund_id.pop().match(/[a-z0-9]{64}/).pop();
                        let investments = fund.amounts.map(i => [fund_id, i[0], i[1]]);
                        promises.push(DB.query("INSERT INTO BobsFundInvestments(fund_id, floID, amount_in) VALUES ?", [investments]));
                    }
                    else {
                        let details = bobsFund.parse.end(d.data);
                        if (details.fundID && details.floID && details.amountFinal)
                            promises.push(DB.query("UPDATE BobsFundInvestments SET close_id=? amount_out=? WHERE fund_id=? AND floID=?", [d.txid, details.amountFinal, details.fundID, details.floID]));
                    }
                });
                promises.push(DB.query("INSERT INTO LastTx (floID, num) VALUE (?) ON DUPLICATE KEY UPDATE num=?", [[bobsFund.config.adminID, result.totalTxs], result.totalTxs]));
                Promise.allSettled(promises).then(results => {
                    //console.debug(results.filter(r => r.status === "rejected"));
                    if (results.reduce((a, r) => r.status === "rejected" ? ++a : a, 0))
                        console.warn("Some fund data might not have been saved in database correctly");
                    resolve(result.totalTxs);
                })
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function closeFund(fund_id, floID, ref) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT r_status FROM CloseFundTransact WHERE fund_id=?", [fund_id]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, `Fund closing already in process`));
            DB.query("SELECT * FROM BobsFund WHERE fund_id=?", [fund_id]).then(result => {
                if (!result.length)
                    return reject(INVALID(eCode.NOT_FOUND, 'Fund not found'));
                let fund = result[0];
                DB.query("SELECT * FROM BobsFundInvestments WHERE fund_id=? AND floID=?", [fund_id, floID]).then(result => {
                    if (!result.length)
                        return reject(INVALID(eCode.NOT_OWNER, 'User is not an investor of this fund'));
                    let investment = result[0];
                    if (investment.close_id)
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, `Fund investment already closed (${investment.close_id})`));
                    let cur_date = new Date();
                    if (cur_date < bobsFund.dateAdder(fund.begin_date, fund.duration)) {
                        let flag = false;
                        if (fund.tapout_window && fund.tapout_interval) {
                            let tapout_intervals = fund.tapout_interval.split(",");
                            for (let ti of tapout_intervals) {
                                let t_start = bobsFund.dateAdder(fund.begin_date, ti),
                                    t_end = bobsFund.dateAdder(t_start, fund.tapout_window);
                                if (t_start < cur_date && cur_date < t_end) {
                                    flag = true; break;
                                }
                            }
                        }
                        if (!flag)
                            return reject(INVALID(eCode.INSUFFICIENT_PERIOD, 'Fund still in lock-in period'));
                    }
                    getRate.BTC_USD().then(btc_rate => {
                        getRate.USD_INR().then(usd_rate => {
                            let net_value = bobsFund.calcNetValue(fund.btc_base, btc_rate, fund.usd_base, usd_rate, investment.amount_in, fund.fee)
                            DB.query("INSERT INTO CloseFundTransact(fund_id, floID, amount, end_date, btc_net, usd_net, ref_sign, r_status) VALUE ?", [[fund_id, floID, net_value, cur_date, btc_rate, usd_rate, ref, pCode.STATUS_PENDING]])
                                .then(result => resolve({ "USD_net": usd_rate, "BTC_net": btc_rate, "amount_out": net_value, "end_date": cur_date }))
                                .catch(error => reject(error))
                        }).catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    refresh: refreshBlockchainData,
    set DB(db) {
        DB = db;
    },
    util: bobsFund,
    closeFund
}