'use strict';

const DB = require("../database");
const eCode = require('../../docs/scripts/floExchangeAPI').errorCode;
const pCode = require('../../docs/scripts/floExchangeAPI').processCode;
const getRate = require('./conversion').getRate;

const blockchainBond = (function () {
    const productStr = "Product: RanchiMall Bitcoin Bond";

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
    const yearDiff = (d1 = null, d2 = null) => {
        d1 = d1 ? new Date(d1) : new Date();
        d2 = d2 ? new Date(d2) : new Date();
        let y = d1.getYear() - d2.getYear(),
            m = d1.getMonth() - d2.getMonth(),
            d = d1.getDate() - d2.getDate()
        return y + m / 12 + d / 365;
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

    function calcNetValue(BTC_base, BTC_net, startDate, minIpa, maxPeriod, cut, amount, USD_base, USD_net) {
        let gain, duration, interest, net;
        gain = (BTC_net - BTC_base) / BTC_base;
        duration = yearDiff(Math.min(Date.now(), dateAdder(startDate, maxPeriod).getTime()), startDate);
        interest = Math.max(cut * gain, minIpa * duration);
        net = amount / USD_base;
        net += net * interest;
        return net * USD_net;
    }

    function stringify_main(BTC_base, start_date, guaranteed_interest, guarantee_period, gain_cut, amount, USD_base, lockin_period, floID) {
        return [
            `${productStr}`,
            `Base value: ${BTC_base} USD`,
            `Date of bond start: ${dateFormat(start_date)}`,
            `Guaranteed interest: ${guaranteed_interest}% per annum simple for ${guarantee_period}`,
            `Bond value: guaranteed interest or ${gain_cut}% of the gains whichever is higher`,
            `Amount invested: Rs ${amount}`,
            `USD INR rate at start: ${USD_base}`,
            `Lockin period: ${lockin_period}`,
            `FLO ID of Bond Holder: ${floID}`
        ].join("|");
    }

    function parse_main(data) {
        //Data (add bond) sent by admin 
        let details = {};
        data.split("|").forEach(d => {
            d = d.split(': ');
            switch (d[0].toLowerCase()) {
                case "base value":
                    details["BTC_base"] = parseNumber(d[1].slice(0, -4)); break;
                case "date of bond start":
                    details["startDate"] = new Date(d[1]); break;
                case "guaranteed interest":
                    details["minIpa"] = parseFloat(d[1].match(/\d+%/)) / 100;
                    details["maxPeriod"] = parsePeriod(d[1].match(/for .+/).toString()); break;
                case "bond value":
                    details["cut"] = parseFloat(d[1].match(/\d+%/)) / 100; break;
                case "amount invested":
                    details["amount"] = parseNumber(d[1].substring(3)); break;
                case "usd inr rate at start":
                    details["USD_base"] = parseFloat(d[1]); break;
                case "lockin period":
                    details["lockinPeriod"] = parsePeriod(d[1]); break;
                case "flo id of bond holder":
                    details["floID"] = d[1]; break;
            }
        });
        return details;
    }

    function stringify_end(bond_id, end_date, BTC_net, USD_net, amount, ref_sign, payment_ref) {
        return [
            `${productStr}`,
            `Bond: ${bond_id}`,
            `End value: ${BTC_net} USD`,
            `Date of bond end: ${dateFormat(end_date)}`,
            `USD INR rate at end: ${USD_net}`,
            `Amount withdrawn: Rs ${amount} via ${payment_ref}`,
            `Reference: ${ref_sign}`
        ].join("|");
    }

    function parse_end(data) {
        //Data (end bond) send by market nodes
        let details = {};
        data.split("|").forEach(d => {
            d = d.split(': ');
            switch (d[0].toLowerCase()) {
                case "bond":
                    details["bondID"] = d[1]; break;
                case "end value":
                    details["BTC_net"] = parseNumber(d[1].slice(0, -4)); break;
                case "date of bond end":
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
        return details;
    }

    return {
        productStr,
        dateAdder,
        dateFormat,
        calcNetValue,
        parse: {
            main: parse_main,
            end: parse_end
        },
        stringify: {
            main: stringify_main,
            end: stringify_end
        }
    }

})();

blockchainBond.config = {
    adminID: "FBBstZ2GretgQqDP55yt8iVd4KNZkdvEzH",
    application: "BlockchainBonds"
}

function refreshBlockchainData(nodeList = []) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT num FROM LastTx WHERE floID=?", [blockchainBond.config.adminID]).then(result => {
            let lastTx = result.length ? result[0].num : 0;
            floBlockchainAPI.readData(blockchainBond.config.adminID, {
                ignoreOld: lastTx,
                senders: nodeList.concat(blockchainBond.config.adminID), //sentOnly: true,
                tx: true,
                filter: d => d.startsWith(blockchainBond.productStr)
            }).then(result => {
                let promises = [];
                result.data.reverse().forEach(d => {
                    let bond = d.senders.has(blockchainBond.config.adminID) ? blockchainBond.parse.main(d.data) : null;
                    if (bond && bond.amount)
                        promises.push(DB.query("INSERT INTO BlockchainBonds(bond_id, floID, amount_in, begin_date, btc_base, usd_base, gain_cut, min_ipa, max_period, lockin_period) VALUES ? ON DUPLICATE KEY UPDATE bond_id=bond_id",
                            [[[d.txid, bond.floID, bond.amount, bond.startDate, bond.BTC_base, bond.USD_base, bond.cut, bond.minIpa, bond.maxPeriod, bond.lockinPeriod]]]));
                    else {
                        let details = blockchainBond.parse.end(d.data);
                        if (details.bondID && details.amountFinal)
                            promises.push(DB.query("UPDATE BlockchainBonds SET close_id=?, amount_out=? WHERE bond_id=?", [d.txid, details.amountFinal, details.bondID]));
                    }
                });
                Promise.allSettled(promises).then(results => {
                    if (results.reduce((a, r) => r.status === "rejected" ? ++a : a, 0)) {
                        reject("Some bond data might not have been saved in database correctly");
                        console.debug(results.filter(r => r.status === "rejected"));
                    }
                    else
                        DB.query("INSERT INTO LastTx (floID, num) VALUE (?) ON DUPLICATE KEY UPDATE num=?", [[blockchainBond.config.adminID, result.totalTxs], result.totalTxs])
                            .then(_ => resolve(result.totalTxs))
                            .catch(error => reject(error));
                })
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function closeBond(bond_id, floID, ref) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT r_status, close_id FROM CloseBondTransact WHERE bond_id=?", [bond_id]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, result[0].r_status == pCode.STATUS_SUCCESS ? `Bond already closed (${result[0].close_id})` : `Bond closing already in process`));
            DB.query("SELECT * FROM BlockchainBonds WHERE bond_id=?", [bond_id]).then(result => {
                if (!result.length)
                    return reject(INVALID(eCode.NOT_FOUND, 'Bond not found'));
                let bond = result[0];
                if (bond.floID !== floID)
                    return reject(INVALID(eCode.NOT_OWNER, 'Bond doesnot belong to the user'));
                if (bond.close_id)
                    return reject(INVALID(eCode.DUPLICATE_ENTRY, `Bond already closed (${bond.close_id})`));
                if (Date.now() < blockchainBond.dateAdder(bond.begin_date, bond.lockin_period).getTime())
                    return reject(INVALID(eCode.INSUFFICIENT_PERIOD, 'Bond still in lock-in period'));
                getRate.BTC_USD().then(btc_rate => {
                    getRate.USD_INR().then(usd_rate => {
                        let end_date = new Date(),
                            net_value = blockchainBond.calcNetValue(bond.btc_base, btc_rate, bond.begin_date, bond.min_ipa, bond.max_period, bond.gain_cut, bond.amount_in, bond.usd_base, usd_rate);
                        DB.query("INSERT INTO CloseBondTransact(bond_id, floID, amount, end_date, btc_net, usd_net, ref_sign, r_status) VALUE (?)", [[bond_id, floID, net_value, end_date, btc_rate, usd_rate, ref, pCode.STATUS_PENDING]])
                            .then(result => resolve({ "USD_net": usd_rate, "BTC_net": btc_rate, "amount_out": net_value, "end_date": end_date }))
                            .catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    refresh(nodeList) {
        refreshBlockchainData(nodeList)
            .then(result => console.debug("Refreshed Blockchain-bonds data"))
            .catch(error => console.error(error));
    },
    util: blockchainBond,
    closeBond
}