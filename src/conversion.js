const _sql = require('./_constants').sql;
const allowedConversion = ["BTC"];

function getRate() {
    return new Promise((resolve, reject) => {
        getRate.BTC_USD().then(BTC_rate => {
            getRate.USD_INR().then(INR_rate => {
                resolve(BTC_rate * INR_rate);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

getRate.BTC_USD = function () {
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

getRate.USD_INR = function () {
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

function convertToCoin(floID, txid, coin) {
    return new Promise((resolve, reject) => {
        if (!allowedConversion.includes(coin))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
        DB.query("SELECT status FROM DirectConvert WHERE in_txid=? AND floID=? mode=?", [txid, floID, _sql.CONVERT_MODE_GET]).then(result => {
            if (result.length)
                return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
            else
                DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, status) VALUES (?, ?, ?, ?, ?)", [floID, txid, _sql.CONVERT_MODE_GET, coin, "PENDING"])
                    .then(result => resolve("Conversion request in process"))
                    .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function convertFromCoin(floID, txid, coin) {
    if (!allowedConversion.includes(coin))
        return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid coin (${coin})`));
    DB.query("SELECT status FROM DirectConvert WHERE in_txid=? AND floID=? mode=?", [txid, floID, _sql.CONVERT_MODE_PUT]).then(result => {
        if (result.length)
            return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
        else
            DB.query("INSERT INTO DirectConvert(floID, in_txid, mode, coin, status) VALUES (?, ?, ?, ?, ?)", [floID, txid, _sql.CONVERT_MODE_PUT, coin, "PENDING"])
                .then(result => resolve("Conversion request in process"))
                .catch(error => reject(error));
    }).catch(error => reject(error))
}

module.exports = {
    getRate,
    convertToCoin,
    convertFromCoin
}