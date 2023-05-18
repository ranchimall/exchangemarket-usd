'use strict';

const DB = require("../database");
const { sink_chest, sink_groups } = require("../keys");
const eCode = require('../../docs/scripts/floExchangeAPI').errorCode;
const pCode = require('../../docs/scripts/floExchangeAPI').processCode;
const getRate = require('./conversion').getRate;

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

    function stringify_continue(fund_id, investments) {
        return [
            `${productStr}`,
            `continue: ${fund_id}`,
            `Investment(s) (INR): ${investments.map(f => `${f[0].trim()}-${f[1].trim()}`).join("; ")}`
        ].join("|");
    }

    function stringify_end(fund_id, floID, end_date, BTC_net, USD_net, amount, ref_sign, payment_ref) {
        return [
            `${productStr}`,
            `close: ${fund_id}`,
            `Investor: ${floID}`,
            `End value: ${BTC_net} USD`,
            `Date of withdrawal: ${dateFormat(end_date)}`,
            `USD INR rate at end: ${USD_net}`,
            `Amount withdrawn: Rs ${amount} via ${payment_ref}`,
            `Reference: ${ref_sign}`
        ].join("|");
    }

    function parse_details(data) {
        let funds = {};
        funds.investments = {};
        if (!Array.isArray(data))
            data = [data];
        data.forEach(fd => {
            if (!/close: [a-z0-9]{64}\|/.test(fd)) { // not a closing tx
                let cont = /continue: [a-z0-9]{64}\|/.test(fd);
                fd.split("|").forEach(d => {
                    d = d.split(': ');
                    if (["invesment(s) (inr)", "investment(s) (inr)"].includes(d[0].toLowerCase()))
                        d[1].split(";").forEach(a => {
                            a = a.split("-");
                            let floID = a[0].replace(/\s/g, ''); //for removing spaces (trailing) if any
                            funds["investments"][floID] = funds["investments"][floID] || {};
                            funds["investments"][floID].amount = parseNumber(a[1])
                        });
                    else if (!cont)
                        switch (d[0].toLowerCase()) {
                            case "start date":
                                funds["start_date"] = new Date(d[1]); break;
                            case "base value":
                                funds["BTC_base"] = parseNumber(d[1].slice(0, -4)); break;
                            case "usd inr rate at start":
                                funds["USD_base"] = parseFloat(d[1]); break;
                            case "duration":
                                funds["duration"] = parsePeriod(d[1]); break;
                            case "management fee":
                                funds["fee"] = parseFloat(d[1]); break;
                            case "tapout availability":
                                let x = d[1].toLowerCase().split("after")
                                funds["tapoutInterval"] = x[1].match(/\d+ [a-z]+/gi).map(y => parsePeriod(y))
                                funds["topoutWindow"] = parsePeriod(x[0]); break;
                        }
                });
            } else {
                let floID, details = {};
                fd.split("|").forEach(d => {
                    d = d.split(': ');
                    switch (d[0].toLowerCase()) {
                        case "investor":
                            floID = d[1]; break;
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
                });
                if (floID) {
                    funds.investments[floID] = funds.investments[floID] || {};
                    funds.investments[floID].closed = details;
                }
            }
        });
        return funds;
    }

    return {
        productStr,
        dateAdder,
        dateFormat,
        calcNetValue,
        parse: parse_details,
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
        DB.query("SELECT txid FROM LastTx WHERE floID=?", [bobsFund.config.adminID]).then(result => {

            var query_options = {
                senders: nodeList.concat(bobsFund.config.adminID),
                tx: true, filter: d => d.startsWith(bobsFund.productStr)
            };
            let lastTx = result.length ? result[0].txid : undefined;
            if (typeof lastTx == 'string' && /^[0-9a-f]{64}/i.test(lastTx))//lastTx is txid of last tx
                query_options.after = lastTx;
            else if (!isNaN(lastTx))//lastTx is tx count (*backward support)
                query_options.ignoreOld = parseInt(lastTx);

            floBlockchainAPI.readData(bobsFund.config.adminID, query_options).then(result => {
                let txQueries = [];
                result.items.reverse().forEach(d => {
                    let fund = bobsFund.parse(d.data);
                    if (d.senders.has(bobsFund.config.adminID) && !/close:/.test(d.data)) {
                        let fund_id = d.data.match(/continue: [a-z0-9]{64}\|/);
                        if (!fund_id) {
                            fund_id = d.txid;
                            let values = [fund_id, fund.start_date, fund.BTC_base, fund.USD_base, fund.fee, fund.duration];
                            if (fund.tapoutInterval)
                                values.push(fund.topoutWindow, fund.tapoutInterval.join(','));
                            else
                                values.push(null, null);
                            txQueries.push(["INSERT INTO BobsFund(fund_id, begin_date, btc_base, usd_base, fee, duration, tapout_window, tapout_interval) VALUE (?) ON DUPLICATE KEY UPDATE fund_id=fund_id", [values]])
                        } else
                            fund_id = fund_id.pop().match(/[a-z0-9]{64}/).pop();
                        let investments = Object.entries(fund.investments).map(a => [fund_id, a[0], a[1].amount]);
                        txQueries.push(["INSERT INTO BobsFundInvestments(fund_id, floID, amount_in) VALUES ? ON DUPLICATE KEY UPDATE floID=floID", [investments]]);
                    }
                    else {
                        let fund_id = d.data.match(/close: [a-z0-9]{64}\|/);
                        if (fund_id) {
                            fund_id = fund_id.pop().match(/[a-z0-9]{64}/).pop();
                            let closing_details = Object.entries(fund.investments).filter(a => typeof a[1].closed === "object" && a[1].closed.amountFinal).pop();   //only one close-fund will be there in a tx
                            if (closing_details)
                                txQueries.push(["UPDATE BobsFundInvestments SET close_id=?, amount_out=? WHERE fund_id=? AND floID=?",
                                    [d.txid, closing_details[1].closed.amountFinal, fund_id, closing_details[0]]])
                        }
                    }
                });
                txQueries.push(["INSERT INTO LastTx (floID, txid) VALUE (?) ON DUPLICATE KEY UPDATE txid=?",
                    [[bobsFund.config.adminID, result.lastItem], result.lastItem]])
                DB.transaction(txQueries)
                    .then(_ => resolve(result.lastItem))
                    .catch(error => reject(["Bobs-Fund refresh data failed!", error]));
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function closeFund(fund_id, floID, ref) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT r_status, close_id FROM CloseFundTransact WHERE fund_id=? AND floID=?", [fund_id, floID]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, result[0].r_status == pCode.STATUS_SUCCESS ? `Fund investment already closed (${result[0].close_id})` : `Fund closing already in process`));
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
                            DB.query("INSERT INTO CloseFundTransact(fund_id, floID, amount, end_date, btc_net, usd_net, ref_sign, r_status) VALUE (?)", [[fund_id, floID, net_value, cur_date, btc_rate, usd_rate, ref, pCode.STATUS_PENDING]])
                                .then(result => resolve({ "USD_net": usd_rate, "BTC_net": btc_rate, "amount_out": net_value, "end_date": cur_date }))
                                .catch(error => reject(error))
                        }).catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function checkFundBalance(prior_time) {
    return new Promise((resolve, reject) => {
        prior_time = new Date(prior_time);
        let cur_date = Date.now();
        if (isNaN(prior_time) || prior_time.toString() == "Invalid Date")
            return reject(INVALID(eCode.INVALID_VALUE, `Invalid Date for prior_time`));
        let sql_query = "SELECT bf.begin_date, bf.btc_base, bf.usd_base, bf.fee, bf.duration, fi.amount_in, cf.amount AS amount_close FROM BobsFund AS bf" +
            " INNER JOIN BobsFundInvestments AS fi ON bf.fund_id = fi.fund_id" +
            " LEFT JOIN CloseFundTransact AS cf ON fi.fund_id = cf.fund_id AND fi.floID = cf.floID" +
            " WHERE fi.close_id IS NULL AND (cf.r_status IS NULL OR cf.r_status NOT IN (?))";
        DB.query(sql_query, [[pCode.STATUS_SUCCESS, pCode.STATUS_CONFIRMATION]]).then(result => {
            getRate.BTC_USD().then(btc_rate => {
                getRate.USD_INR().then(usd_rate => {
                    let pending = { require_amount_cash: 0, n_investment: 0 },
                        ready = { require_amount_cash: 0, n_investment: 0 },
                        upcoming = { require_amount_cash: 0, n_investment: 0 }
                    result.forEach(i => {
                        if (i.amount_close) {
                            pending.require_amount_cash += i.amount_close;
                            pending.n_investment++;
                        } else {
                            let end_date = bobsFund.dateAdder(i.begin_date, i.duration);
                            if (end_date < prior_time) {
                                let net_value = bobsFund.calcNetValue(i.btc_base, btc_rate, i.usd_base, usd_rate, i.amount_in, i.fee);
                                if (end_date > cur_date) {
                                    upcoming.require_amount_cash += net_value;
                                    upcoming.n_investment++;
                                } else {
                                    ready.require_amount_cash += net_value;
                                    ready.n_investment++;
                                }
                            }
                        }
                    })
                    pending.require_amount_cash = global.toStandardDecimal(pending.require_amount_cash);
                    ready.require_amount_cash = global.toStandardDecimal(ready.require_amount_cash);
                    upcoming.require_amount_cash = global.toStandardDecimal(upcoming.require_amount_cash);
                    pending.require_amount_btc = global.toStandardDecimal(pending.require_amount_cash / (btc_rate * usd_rate));
                    ready.require_amount_btc = global.toStandardDecimal(ready.require_amount_cash / (btc_rate * usd_rate));
                    upcoming.require_amount_btc = global.toStandardDecimal(upcoming.require_amount_cash / (btc_rate * usd_rate));
                    Promise.allSettled(sink_chest.list(sink_groups.BOBS_FUND)
                        .map(id => btcOperator.getBalance(btcOperator.convert.legacy2bech(id)))).then(result => {
                            let balance = result.filter(r => r.status === 'fulfilled').reduce((a, bal) => a += bal, 0);
                            resolve({ pending, ready, upcoming, balance });
                        }).catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))


    })
}

module.exports = {
    refresh(nodeList) {
        refreshBlockchainData(nodeList)
            .then(result => console.debug("Refreshed Bob's Fund data"))
            .catch(error => console.error(error));
    },
    util: bobsFund,
    checkFundBalance,
    closeFund
}