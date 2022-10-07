'use strict';

var collectAndCall; //container for collectAndCall function from backup module
var chests; //container for blockchain ids (where assets are stored)

const WITHDRAWAL_MESSAGE = "(withdrawal from market)",
    TYPE_TOKEN = "TOKEN",
    TYPE_COIN = "COIN",
    TYPE_CONVERT = "CONVERT";

const balance_locked = {},
    balance_cache = {},
    callbackCollection = {
        [TYPE_COIN]: {},
        [TYPE_TOKEN]: {},
        [TYPE_CONVERT]: {}
    };

function getBalance(sinkID, asset) {
    switch (asset) {
        case "FLO":
            return floBlockchainAPI.getBalance(sinkID);
        case "BTC":
            let btc_id = btcOperator.convert.legacy2bech(sinkID);
            return btcOperator.getBalance(btc_id);
        default:
            return floTokenAPI.getBalance(sinkID, asset);
    }
}

function getSinkID(quantity, asset, sinkList = null) {
    return new Promise((resolve, reject) => {
        if (!sinkList)
            sinkList = chests.list.map(s => [s, s in balance_cache ? balance_cache[s][asset] || 0 : 0]) //TODO: improve sorting
                .sort((a, b) => b[1] - a[1]).map(x => x[0]);
        if (!sinkList.length)
            return reject(`Insufficient balance in chests for asset(${asset})`);
        let sinkID = sinkList.shift();
        getBalance(sinkID, asset).then(balance => {
            if (!(sinkID in balance_cache))
                balance_cache[sinkID] = {};
            balance_cache[sinkID][asset] = balance;
            if (balance > (quantity + (sinkID in balance_locked ? balance_locked[sinkID][asset] || 0 : 0)))
                return resolve(sinkID);
            else
                getSinkID(quantity, asset, sinkList)
                    .then(result => resolve(result))
                    .catch(error => reject(error))
        }).catch(error => {
            console.error(error);
            getSinkID(quantity, asset, sinkList)
                .then(result => resolve(result))
                .catch(error => reject(error))
        });
    })
}

function sendTx(floID, asset, quantity, sinkID, sinkKey) {
    switch (asset) {
        case "FLO":
            return floBlockchainAPI.sendTx(sinkID, floID, quantity, sinkKey, WITHDRAWAL_MESSAGE);
        case "BTC":
            let btc_sinkID = btcOperator.convert.legacy2bech(sinkID),
                btc_receiver = btcOperator.convert.legacy2bech(floID);
            return btcOperator.sendTx(btc_sinkID, sinkKey, btc_receiver, quantity, null);
        default:
            return floTokenAPI.sendToken(sinkKey, quantity, floID, WITHDRAWAL_MESSAGE, asset);
    }
}

const tableUpdate = {
    [TYPE_COIN]: (id, txid) => {
        DB.query("UPDATE WithdrawCoin SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, id])
            .then(_ => null).catch(error => console.error(error))
    },
    [TYPE_TOKEN]: (id, txid) => {
        DB.query("UPDATE WithdrawToken SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, id])
            .then(_ => null).catch(error => console.error(error))
    },
    [TYPE_CONVERT]: (id, txid) => {
        DB.query("UPDATE DirectConvert SET status=?, out_txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, id])
            .then(_ => null).catch(error => console.error(error));
    }
};

function sendAsset(floID, asset, quantity, type, id) {
    getSinkID(quantity, asset).then(sinkID => {
        let callback = (sinkKey) => {
            //Send asset to user via API
            sendTx(floID, asset, quantity, sinkID, sinkKey).then(txid => {
                if (!txid)
                    console.error("Transaction not successful");
                else //Transaction was successful, Add in DB
                    tableUpdate[type](id, txid);
            }).catch(error => console.error(error)).finally(_ => {
                delete callbackCollection[type][id];
                balance_locked[sinkID][asset] -= quantity;
            });
        }
        collectAndCall(sinkID, callback);
        callbackCollection[type][id] = callback;
        if (!(sinkID in balance_locked))
            balance_locked[sinkID] = {};
        balance_locked[sinkID][asset] = (balance_locked[sinkID][asset] || 0) + quantity;
    }).catch(error => console.error(error))
}

function sendCoin_init(floID, coin, quantity) {
    DB.query("INSERT INTO WithdrawCoin (floID, coin, amount, status) VALUES (?, ?, ?, ?)", [floID, coin, quantity, "PENDING"])
        .then(result => sendAsset(floID, coin, quantity, TYPE_COIN, result.insertId))
        .catch(error => console.error(error))
}

function sendCoin_retry(floID, coin, quantity, id) {
    if (id in callbackCollection[TYPE_COIN])
        console.debug("A callback is already pending for this Coin transfer");
    else
        sendAsset(floID, coin, quantity, TYPE_COIN, id);
}

function sendToken_init(floID, token, quantity) {
    DB.query("INSERT INTO WithdrawToken (floID, token, amount, status) VALUES (?, ?, ?, ?)", [floID, token, quantity, "PENDING"])
        .then(result => sendAsset(floID, quantity, TYPE_TOKEN, result.insertId))
        .catch(error => console.error(error))
}

function sendToken_retry(floID, token, quantity, id) {
    if (id in callbackCollection[TYPE_TOKEN])
        console.debug("A callback is already pending for this Token transfer");
    else
        sendAsset(floID, token, quantity, TYPE_TOKEN, id);
}

function convertToCoin_init(floID, coin, currency_amount, coin_quantity, id) {
    DB.query("UPDATE DirectConvert SET amount=?, quantity=?, status=?, locktime=DEFAULT WHERE id=?", [currency_amount, coin_quantity, "PROCESSING", id])
        .then(result => sendAsset(floID, coin, coin_quantity, TYPE_CONVERT, id))
        .catch(error => console.error(error))
}

function convertToCoin_retry(floID, coin, coin_quantity, id) {
    if (id in callbackCollection[TYPE_CONVERT])
        console.debug("A callback is already pending for this Coin Convert");
    else
        sendAsset(floID, coin, coin_quantity, TYPE_CONVERT, id);
}

function convertFromCoin_init(floID, currency_amount, coin_quantity, id) {
    DB.query("UPDATE DirectConvert SET amount=?, quantity=?, status=?, locktime=DEFAULT WHERE id=?", [currency_amount, coin_quantity, "PROCESSING", id])
        .then(result => sendAsset(floID, floGlobals.currency, currency_amount, TYPE_CONVERT, id))
        .catch(error => console.error(error))
}

function convertFromCoin_retry(floID, current_amount, id) {
    if (id in callbackCollection[TYPE_CONVERT])
        console.debug("A callback is already pending for this Coin Convert");
    else
        sendAsset(floID, floGlobals.currency, current_amount, TYPE_CONVERT, id);
}

module.exports = {
    set collectAndCall(fn) {
        collectAndCall = fn;
    },
    get chests() {
        return chests;
    },
    set chests(c) {
        chests = c;
    },
    sendCoin: {
        init: sendCoin_init,
        retry: sendCoin_retry
    },
    sendToken: {
        init: sendToken_init,
        retry: sendToken_retry
    },
    convertToCoin: {
        init: convertToCoin_init,
        retry: convertToCoin_retry
    },
    convertFromCoin: {
        init: convertFromCoin_init,
        retry: convertFromCoin_retry
    }
}