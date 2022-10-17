'use strict';

var collectAndCall; //container for collectAndCall function from backup module
var chests; //container for blockchain ids (where assets are stored)
var DB; //container for database

const TYPE_TOKEN = "TOKEN",
    TYPE_COIN = "COIN",
    TYPE_CONVERT = "CONVERT",
    TYPE_REFUND = "REFUND",
    TYPE_BOND = "BOND",
    TYPE_FUND = "BOB-FUND";

const balance_locked = {},
    balance_cache = {},
    callbackCollection = {
        [TYPE_COIN]: {},
        [TYPE_TOKEN]: {},
        [TYPE_CONVERT]: {},
        [TYPE_REFUND]: {},
        [TYPE_BOND]: {},
        [TYPE_FUND]: {}
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

const WITHDRAWAL_MESSAGE = {
    [TYPE_COIN]: "(withdrawal from market)",
    [TYPE_TOKEN]: "(withdrawal from market)",
    [TYPE_CONVERT]: "(convert coin)",
    [TYPE_REFUND]: "(refund from market)",
    [TYPE_BOND]: "(bond closing)",
    [TYPE_FUND]: "(fund investment closing)"
}

function sendTx(floID, asset, quantity, sinkID, sinkKey, message) {
    switch (asset) {
        case "FLO":
            return floBlockchainAPI.sendTx(sinkID, floID, quantity, sinkKey, message);
        case "BTC":
            let btc_sinkID = btcOperator.convert.legacy2bech(sinkID),
                btc_receiver = btcOperator.convert.legacy2bech(floID);
            return btcOperator.sendTx(btc_sinkID, sinkKey, btc_receiver, quantity, null);
        default:
            return floTokenAPI.sendToken(sinkKey, quantity, floID, message, asset);
    }
}

const updateSyntax = {
    [TYPE_COIN]: "UPDATE WithdrawCoin SET status=?, txid=? WHERE id=?",
    [TYPE_TOKEN]: "UPDATE WithdrawToken SET status=?, txid=? WHERE id=?",
    [TYPE_CONVERT]: "UPDATE DirectConvert SET status=?, out_txid=? WHERE id=?",
    [TYPE_REFUND]: "UPDATE RefundTransact SET status=?, out_txid=? WHERE id=?",
    [TYPE_BOND]: "UPDATE CloseBondTransact SET status=?, txid=? WHERE id=?",
    [TYPE_FUND]: "UPDATE CloseFundTransact SET status=?, txid=? WHERE id=?"
};

function sendAsset(floID, asset, quantity, type, id) {
    getSinkID(quantity, asset).then(sinkID => {
        let callback = (sinkKey) => {
            //Send asset to user via API
            sendTx(floID, asset, quantity, sinkID, sinkKey, WITHDRAWAL_MESSAGE[type]).then(txid => {
                if (!txid)
                    console.error("Transaction not successful");
                else //Transaction was successful, Add in DB
                    DB.query(updateSyntax[type], ["WAITING_CONFIRMATION", txid, id])
                        .then(_ => null).catch(error => console.error(error));
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
    else sendAsset(floID, coin, quantity, TYPE_COIN, id);
}

function sendToken_init(floID, token, quantity) {
    DB.query("INSERT INTO WithdrawToken (floID, token, amount, status) VALUES (?, ?, ?, ?)", [floID, token, quantity, "PENDING"])
        .then(result => sendAsset(floID, quantity, TYPE_TOKEN, result.insertId))
        .catch(error => console.error(error))
}

function sendToken_retry(floID, token, quantity, id) {
    if (id in callbackCollection[TYPE_TOKEN])
        console.debug("A callback is already pending for this Token transfer");
    else sendAsset(floID, token, quantity, TYPE_TOKEN, id);
}

function convertToCoin_init(floID, coin, coin_quantity, id) {
    DB.query("UPDATE DirectConvert SET quantity=?, status=?, locktime=DEFAULT WHERE id=?", [coin_quantity, "PROCESSING", id])
        .then(result => sendAsset(floID, coin, coin_quantity, TYPE_CONVERT, id))
        .catch(error => console.error(error))
}

function convertToCoin_retry(floID, coin, coin_quantity, id) {
    if (id in callbackCollection[TYPE_CONVERT])
        console.debug("A callback is already pending for this Coin convert");
    else sendAsset(floID, coin, coin_quantity, TYPE_CONVERT, id);
}

function convertFromCoin_init(floID, currency_amount, id) {
    DB.query("UPDATE DirectConvert SET amount=?, status=?, locktime=DEFAULT WHERE id=?", [currency_amount, "PROCESSING", id])
        .then(result => sendAsset(floID, floGlobals.currency, currency_amount, TYPE_CONVERT, id))
        .catch(error => console.error(error))
}

function convertFromCoin_retry(floID, currency_amount, id) {
    if (id in callbackCollection[TYPE_CONVERT])
        console.debug("A callback is already pending for this Coin Convert");
    else sendAsset(floID, floGlobals.currency, currency_amount, TYPE_CONVERT, id);
}

function bondTransact_retry(floID, amount, id) {
    if (id in callbackCollection[TYPE_BOND])
        console.debug("A callback is already pending for this Bond closing");
    else sendAsset(floID, floGlobals.currency, amount, TYPE_BOND, id);
}

function fundTransact_retry(floID, amount, id) {
    if (id in callbackCollection[TYPE_FUND])
        console.debug("A callback is already pending for this Fund investment closing");
    else sendAsset(floID, floGlobals.currency, amount, TYPE_FUND, id);
}

function refundTransact_init(floID, amount, id) {
    DB.query("UPDATE RefundTransact SET amount=?, status=?, locktime=DEFAULT WHERE id=?", [amount, "PROCESSING", id])
        .then(result => sendAsset(floID, floGlobals.currency, amount, TYPE_REFUND, id))
        .catch(error => console.error(error))
}

function refundTransact_retry(floID, amount, id) {
    if (id in callbackCollection[TYPE_REFUND])
        console.debug("A callback is already pending for this Refund");
    else sendAsset(floID, floGlobals.currency, amount, TYPE_REFUND, id);
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
    },
    bondTransact: {
        retry: bondTransact_retry
    },
    fundTransact: {
        retry: fundTransact_retry
    },
    refundTransact: {
        init: refundTransact_init,
        retry: refundTransact_retry
    },
    set DB(db) {
        DB = db;
    }
}