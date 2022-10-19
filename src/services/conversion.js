'use strict';

const { MIN_FUND } = require('../_constants')['convert'];
const eCode = require('../../docs/scripts/floExchangeAPI').errorCode;
const pCode = require('../../docs/scripts/floExchangeAPI').processCode;

const allowedConversion = ["BTC"];

var DB; //container for database

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

function checkPoolBalance(coin, req_value, mode) {
    return new Promise((resolve, reject) => {
        if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        let q = "SELECT mode, SUM(quantity) AS coin_val, SUM(amount) AS cash_val FROM (" +
            "(SELECT amount, coin, quantity, mode, r_status FROM DirectConvert) UNION " +
            "(SELECT amount, coin, quantity, mode, r_status FROM ConvertFund) " +
            ") WHERE coin=? AND r_status NOT IN (?) GROUP BY mode"
        DB.query(q, [coin, [pCode.STATUS_REJECTED, "REFUND"]]).then(result => {
            let coin_net = 0, cash_net = 0;
            for (let r of result)
                if (r.mode == pCodeCONVERT_MODE_GET) {
                    coin_net -= r.coin_val;
                    cash_net += r.cash_val;
                } else if (r.mode == pCodeCONVERT_MODE_PUT) {
                    coin_net += r.coin_val;
                    cash_net -= r.cash_val;
                }
            BTC_INR().then(rate => {
                coin_net = coin_net * rate;
                let availability = -1;
                if (mode == pCodeCONVERT_MODE_GET)
                    availability = coin_net - cash_net * MIN_FUND;
                else if (mode == pCodeCONVERT_MODE_PUT) {
                    availability = cash_net - coin_net * MIN_FUND;
                    req_value = req_value * rate; //convert to currency value
                }
                if (req_value > availability)
                    reject(INVALID(eCode.INSUFFICIENT_FUND, `Insufficient convert! Availability: ${availability > 0 ? availability : 0}`));
                else
                    resolve(true);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function convertToCoin(floID, txid, coin, amount) {
    return new Promise((resolve, reject) => {
        if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid amount (${amount})`));
        DB.query("SELECT r_status FROM DirectConvert WHERE in_txid=? AND floID=? AND mode=?", [txid, floID, pCodeCONVERT_MODE_GET]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            checkPoolBalance(coin, amount, pCodeCONVERT_MODE_GET).then(result => {
                DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, amount, r_status) VALUES (?)", [[floID, txid, pCodeCONVERT_MODE_GET, coin, amount, pCode.STATUS_PENDING]])
                    .then(result => resolve("Conversion request in process"))
                    .catch(error => reject(error));
            }).catch(error => {
                if (error instanceof INVALID && error.ecode === eCode.INSUFFICIENT_FUND)
                    DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, amount, r_status) VALUES (?)", [[floID, txid, pCodeCONVERT_MODE_GET, coin, amount, "REFUND"]]).then(result => {
                        DB.query("INSERT INTO RefundTransact(floID, in_txid, amount, r_status) VALUES (?)", [[floID, txid, amount, pCode.STATUS_PENDING]])
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
        else if (btcOperator.transactionID(tx_hex) !== txid)
            return reject(INVALID(eCode.INVALID_TX_ID, `txid ${txid} doesnt match the tx-hex`));
        DB.query("SELECT r_status FROM DirectConvert WHERE in_txid=? AND floID=? AND mode=?", [txid, floID, pCodeCONVERT_MODE_PUT]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            checkPoolBalance(coin, quantity, pCodeCONVERT_MODE_PUT).then(result => {
                btcOperator.broadcastTx(tx_hex).then(b_txid => {
                    if (b_txid !== txid)
                        console.warn("broadcast TX-ID is not same as calculated TX-ID");
                    DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, quantity, r_status) VALUES (?)", [[floID, b_txid, pCodeCONVERT_MODE_PUT, coin, quantity, pCode.STATUS_PENDING]])
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
        DB.query("SELECT r_status FROM ConvertFund WHERE txid=? AND mode=?", [txid, pCodeCONVERT_MODE_GET]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            DB.query("INSERT INTO ConvertFund(txid, mode, coin, r_status) VALUES (?)", [[b_txid, pCodeCONVERT_MODE_GET, coin, pCode.STATUS_PROCESSING]])
                .then(result => resolve("Add currency fund in process"))
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
        DB.query("SELECT r_status FROM ConvertFund WHERE txid=? AND mode=?", [txid, pCodeCONVERT_MODE_PUT]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            DB.query("INSERT INTO ConvertFund(txid, mode, coin, r_status) VALUES (?)", [[b_txid, pCodeCONVERT_MODE_PUT, coin, pCode.STATUS_PROCESSING]])
                .then(result => resolve("Add coin fund in process"))
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
        DB.query("SELECT SUM(amount) AS deposit_amount FROM ConvertFund WHERE mode=? AND r_status=?", [pCodeCONVERT_MODE_GET, pCode.STATUS_SUCCESS]).then(r1 => {
            DB.query("SELECT SUM(amount) AS withdraw_amount FROM ConvertFund WHERE mode=? AND r_status IN (?)", [pCodeCONVERT_MODE_PUT, [pCode.STATUS_SUCCESS, pCode.STATUS_PENDING, pCode.STATUS_CONFIRMATION]]).then(r2 => {
                let available_amount = (r1[0].deposit_amount || 0) - (r2[0].withdraw_amount || 0);
                if (available_amount < amount)
                    return reject(INVALID(eCode.INSUFFICIENT_BALANCE, "Insufficient convert-fund deposits to withdraw"));
                DB.query("INSERT INTO ConvertFund(mode, coin, amount, r_status) VALUES (?)", [[pCodeCONVERT_MODE_PUT, coin, amount, pCode.STATUS_PENDING]])
                    .then(result => resolve("Add currency fund in process"))
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
        DB.query("SELECT SUM(quantity) AS deposit_quantity FROM ConvertFund WHERE mode=? AND r_status=?", [pCodeCONVERT_MODE_PUT, pCode.STATUS_SUCCESS]).then(r1 => {
            DB.query("SELECT SUM(quantity) AS withdraw_quantity FROM ConvertFund WHERE mode=? AND r_status IN (?)", [pCodeCONVERT_MODE_GET, [pCode.STATUS_SUCCESS, pCode.STATUS_PENDING]]).then(r2 => {
                let available_quantity = (r1[0].deposit_quantity || 0) - (r2[0].withdraw_quantity || 0);
                if (available_quantity < quantity)
                    return reject(INVALID(eCode.INSUFFICIENT_BALANCE, "Insufficient convert-fund deposits to withdraw"));
                DB.query("INSERT INTO ConvertFund(mode, coin, quantity, r_status) VALUES (?)", [[pCodeCONVERT_MODE_GET, coin, quantity, pCode.STATUS_PENDING]])
                    .then(result => resolve("Add currency fund in process"))
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
    convertToCoin,
    convertFromCoin,
    depositFund: {
        coin: depositCoinFund,
        currency: depositCurrencyFund
    },
    withdrawFund: {
        coin: withdrawCoinFund,
        currency: withdrawCurrencyFund
    },
    set DB(db) {
        DB = db;
    }
}