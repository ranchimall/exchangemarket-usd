'use strict';

const DB = require("../database");
const eCode = require('../../docs/scripts/floExchangeAPI').errorCode;
const pCode = require('../../docs/scripts/floExchangeAPI').processCode;

const {
    MIN_FUND,
    TO_FIXED_VALUES,
    TO_MAX_VALUE,
    TO_MIN_VALUE,
    FROM_FIXED_VALUES,
    FROM_MAX_VALUE,
    FROM_MIN_VALUE
} = require('../_constants')['convert'];

const allowedConversion = ["BTC"];

function BTC_INR() {
    return new Promise((resolve, reject) => {
        BTC_USD().then(btc_usd => {
            USD_INR().then(usd_inr => {
                resolve(btc_usd * usd_inr);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function BTC_USD() {
    return new Promise((resolve, reject) => {
        fetch('https://api.coinlore.net/api/ticker/?id=90').then(response => {
            if (response.ok) {
                response.json()
                    .then(result => resolve(result[0].price_usd))
                    .catch(error => reject(error));
            } else
                reject(response.status);
        }).catch(error => reject(error));
    });
}

function USD_INR() {
    return new Promise((resolve, reject) => {
        fetch('https://api.exchangerate-api.com/v4/latest/usd').then(response => {
            if (response.ok) {
                response.json()
                    .then(result => resolve(result.rates['INR']))
                    .catch(error => reject(error));
            } else
                reject(response.status);
        }).catch(error => reject(error));
    });
}

function getPoolAvailability(coin) {
    return new Promise((resolve, reject) => {
        if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        let q = "SELECT mode, SUM(quantity) AS coin_val, SUM(amount) AS cash_val FROM (" +
            "(SELECT amount, coin, quantity, mode, r_status FROM DirectConvert) UNION " +
            "(SELECT amount, coin, quantity, mode, r_status FROM ConvertFund) " +
            ") AS T1 WHERE T1.coin=? AND T1.r_status NOT IN (?) GROUP BY T1.mode";
        DB.query(q, [coin, [pCode.STATUS_REJECTED]]).then(result => {
            let coin_net = 0, cash_net = 0;
            for (let r of result)
                if (r.mode == pCode.CONVERT_MODE_GET) {
                    coin_net -= r.coin_val;
                    cash_net += r.cash_val;
                } else if (r.mode == pCode.CONVERT_MODE_PUT) {
                    coin_net += r.coin_val;
                    cash_net -= r.cash_val;
                }
            BTC_INR().then(rate => {
                coin_net = coin_net * rate;
                let cash_availability = cash_net - coin_net * MIN_FUND,
                    coin_availability = (coin_net - cash_net * MIN_FUND) / rate;
                if (cash_availability < 0) cash_availability = 0;
                if (coin_availability < 0) coin_availability = 0;
                resolve({ cash: cash_availability, coin: coin_availability, rate })
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function checkPoolBalance(coin, req_value, mode) {
    return new Promise((resolve, reject) => {
        getPoolAvailability(coin).then(result => {
            let availability = -1;
            if (mode == pCode.CONVERT_MODE_GET) {
                availability = result.coin;
                req_value = req_value / result.rate; //convert to coin value
            }
            else if (mode == pCode.CONVERT_MODE_PUT) {
                availability = result.cash;
                req_value = req_value * result.rate; //convert to currency value
            }
            if (req_value > availability)
                reject(INVALID(eCode.INSUFFICIENT_FUND, `Insufficient convert! Availability: ${availability > 0 ? availability : 0}`));
            else
                resolve(true);
        }).catch(error => reject(error))
    })
}

function getConvertValues() {
    return new Promise((resolve, reject) => {
        getPoolAvailability("BTC").then(avail => {
            let result = {};
            if (avail.coin > 0) {
                let coin_availability = global.toStandardDecimal(avail.coin * avail.rate); //convert to currency value
                if (Array.isArray(TO_FIXED_VALUES) && TO_FIXED_VALUES.length)
                    result[pCode.CONVERT_MODE_GET] = TO_FIXED_VALUES.filter(a => a < coin_availability);
                else if (!TO_MIN_VALUE || TO_MIN_VALUE <= coin_availability) {
                    result[pCode.CONVERT_MODE_GET] = { min: 0 };
                    result[pCode.CONVERT_MODE_GET].max = (!TO_MAX_VALUE || TO_MAX_VALUE >= coin_availability) ? coin_availability : TO_MAX_VALUE;
                }
            } else result[pCode.CONVERT_MODE_GET] = null;
            if (avail.cash > 0) {
                let cash_availability = global.toStandardDecimal(avail.cash / avail.rate); //convert to coin value
                if (Array.isArray(FROM_FIXED_VALUES) && FROM_FIXED_VALUES.length)
                    result[pCode.CONVERT_MODE_PUT] = FROM_FIXED_VALUES.filter(a => a < cash_availability);
                else if (!FROM_MIN_VALUE || FROM_MIN_VALUE <= cash_availability) {
                    result[pCode.CONVERT_MODE_PUT] = { min: 0 };
                    result[pCode.CONVERT_MODE_PUT].max = (!FROM_MAX_VALUE || FROM_MAX_VALUE >= cash_availability) ? cash_availability : FROM_MAX_VALUE;
                }
            } else result[pCode.CONVERT_MODE_PUT] = null;
            resolve(result)
        }).catch(error => reject(error))
    })
}

function convertToCoin(floID, txid, coin, amount) {
    return new Promise((resolve, reject) => {
        if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid amount (${amount})`));
        else if (Array.isArray(TO_FIXED_VALUES) && TO_FIXED_VALUES.length) {
            if (!TO_FIXED_VALUES.includes(amount))
                return reject(INVALID(eCode.INVALID_NUMBER, `Invalid amount (${amount})`));
        } else if (TO_MIN_VALUE && TO_MIN_VALUE > amount || TO_MAX_VALUE && TO_MAX_VALUE < amount)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid amount (${amount})`));
        DB.query("SELECT r_status FROM DirectConvert WHERE in_txid=? AND floID=? AND mode=?", [txid, floID, pCode.CONVERT_MODE_GET]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            checkPoolBalance(coin, amount, pCode.CONVERT_MODE_GET).then(result => {
                DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, amount, r_status) VALUES (?)", [[floID, txid, pCode.CONVERT_MODE_GET, coin, amount, pCode.STATUS_PENDING]])
                    .then(result => resolve("Conversion request in process"))
                    .catch(error => reject(error));
            }).catch(error => {
                if (error instanceof INVALID && error.ecode === eCode.INSUFFICIENT_FUND)
                    DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, amount, r_status) VALUES (?)", [[floID, txid, pCode.CONVERT_MODE_GET, coin, amount, pCode.STATUS_REJECTED]]).then(result => {
                        DB.query("INSERT INTO RefundConvert(floID, in_txid, asset_type, asset, r_status) VALUES (?)", [[floID, txid, pCode.ASSET_TYPE_TOKEN, floGlobals.currency, pCode.STATUS_PENDING]])
                            .then(_ => null).catch(error => console.error(error));
                    }).catch(error => console.error(error))
                reject(error);
            })
        }).catch(error => reject(error))
    });
}

function convertFromCoin(floID, txid, tx_hex, coin, quantity) {
    return new Promise((resolve, reject) => {
        if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid quantity (${quantity})`));
        else if (Array.isArray(FROM_FIXED_VALUES) && FROM_FIXED_VALUES.length) {
            if (!FROM_FIXED_VALUES.includes(quantity))
                return reject(INVALID(eCode.INVALID_NUMBER, `Invalid quantity (${quantity})`));
        } else if (FROM_MIN_VALUE && FROM_MIN_VALUE > quantity || FROM_MAX_VALUE && FROM_MAX_VALUE < quantity)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid quantity (${quantity})`));
        else if (btcOperator.transactionID(tx_hex) !== txid)
            return reject(INVALID(eCode.INVALID_TX_ID, `txid ${txid} doesnt match the tx-hex`));
        DB.query("SELECT r_status FROM DirectConvert WHERE in_txid=? AND floID=? AND mode=?", [txid, floID, pCode.CONVERT_MODE_PUT]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            checkPoolBalance(coin, quantity, pCode.CONVERT_MODE_PUT).then(result => {
                btcOperator.broadcastTx(tx_hex).then(b_txid => {
                    if (b_txid !== txid)
                        console.warn("broadcast TX-ID is not same as calculated TX-ID");
                    DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, quantity, r_status) VALUES (?)", [[floID, b_txid, pCode.CONVERT_MODE_PUT, coin, quantity, pCode.STATUS_PENDING]])
                        .then(result => resolve("Conversion request in process"))
                        .catch(error => reject(error));
                }).catch(error => {
                    if (error === null)
                        reject(INVALID(eCode.INVALID_TX_ID, `Invalid transaction hex`));
                    else
                        reject(error);
                })
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function depositCurrencyFund(floID, txid, coin) {
    return new Promise((resolve, reject) => {
        if (floID !== floGlobals.adminID)
            return reject(INVALID(eCode.ACCESS_DENIED, 'Access Denied'));
        else if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        DB.query("SELECT r_status FROM ConvertFund WHERE txid=? AND mode=?", [txid, pCode.CONVERT_MODE_GET]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            DB.query("INSERT INTO ConvertFund(txid, mode, coin, r_status) VALUES (?)", [[txid, pCode.CONVERT_MODE_GET, coin, pCode.STATUS_PROCESSING]])
                .then(result => resolve("Deposit currency fund in process"))
                .catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function depositCoinFund(floID, txid, coin) {
    return new Promise((resolve, reject) => {
        if (floID !== floGlobals.adminID)
            return reject(INVALID(eCode.ACCESS_DENIED, 'Access Denied'));
        else if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        DB.query("SELECT r_status FROM ConvertFund WHERE txid=? AND mode=?", [txid, pCode.CONVERT_MODE_PUT]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            DB.query("INSERT INTO ConvertFund(txid, mode, coin, r_status) VALUES (?)", [[txid, pCode.CONVERT_MODE_PUT, coin, pCode.STATUS_PROCESSING]])
                .then(result => resolve("Deposit coin fund in process"))
                .catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function withdrawCurrencyFund(floID, coin, amount) {
    return new Promise((resolve, reject) => {
        if (floID !== floGlobals.adminID)
            return reject(INVALID(eCode.ACCESS_DENIED, 'Access Denied'));
        else if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        DB.query("SELECT SUM(amount) AS deposit_amount FROM ConvertFund WHERE mode=? AND r_status=?", [pCode.CONVERT_MODE_GET, pCode.STATUS_SUCCESS]).then(r1 => {
            DB.query("SELECT SUM(amount) AS withdraw_amount FROM ConvertFund WHERE mode=? AND r_status IN (?)", [pCode.CONVERT_MODE_PUT, [pCode.STATUS_SUCCESS, pCode.STATUS_PENDING, pCode.STATUS_CONFIRMATION]]).then(r2 => {
                let available_amount = (r1[0].deposit_amount || 0) - (r2[0].withdraw_amount || 0);
                if (available_amount < amount)
                    return reject(INVALID(eCode.INSUFFICIENT_BALANCE, "Insufficient convert-fund deposits to withdraw"));
                DB.query("INSERT INTO ConvertFund(mode, coin, amount, r_status) VALUES (?)", [[pCode.CONVERT_MODE_PUT, coin, amount, pCode.STATUS_PENDING]])
                    .then(result => resolve("Withdraw currency fund in process"))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function withdrawCoinFund(floID, coin, quantity) {
    return new Promise((resolve, reject) => {
        if (floID !== floGlobals.adminID)
            return reject(INVALID(eCode.ACCESS_DENIED, 'Access Denied'));
        else if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        DB.query("SELECT SUM(quantity) AS deposit_quantity FROM ConvertFund WHERE mode=? AND r_status=?", [pCode.CONVERT_MODE_PUT, pCode.STATUS_SUCCESS]).then(r1 => {
            DB.query("SELECT SUM(quantity) AS withdraw_quantity FROM ConvertFund WHERE mode=? AND r_status IN (?)", [pCode.CONVERT_MODE_GET, [pCode.STATUS_SUCCESS, pCode.STATUS_PENDING]]).then(r2 => {
                let available_quantity = (r1[0].deposit_quantity || 0) - (r2[0].withdraw_quantity || 0);
                if (available_quantity < quantity)
                    return reject(INVALID(eCode.INSUFFICIENT_BALANCE, "Insufficient convert-fund deposits to withdraw"));
                DB.query("INSERT INTO ConvertFund(mode, coin, quantity, r_status) VALUES (?)", [[pCode.CONVERT_MODE_GET, coin, quantity, pCode.STATUS_PENDING]])
                    .then(result => resolve("Withdraw currency fund in process"))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    getRate: {
        BTC_USD,
        USD_INR,
        BTC_INR
    },
    getConvertValues,
    convertToCoin,
    convertFromCoin,
    depositFund: {
        coin: depositCoinFund,
        currency: depositCurrencyFund
    },
    withdrawFund: {
        coin: withdrawCoinFund,
        currency: withdrawCurrencyFund
    }
}