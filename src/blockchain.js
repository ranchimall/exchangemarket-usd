'use strict';

var collectAndCall; //container for collectAndCall function from backup module
var chests; //container for blockchain ids (where assets are stored)

const WITHDRAWAL_MESSAGE = "(withdrawal from market)";

const balance_locked = {},
    balance_cache = {},
    callbackCollection = {
        Coin: {},
        token: {}
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

function getSinkID(amount, asset, sinkList = null) {
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
            if (balance > (amount + (sinkID in balance_locked ? balance_locked[sinkID][asset] || 0 : 0)))
                return resolve(sinkID);
            else
                getSinkID(amount, asset, sinkList)
                .then(result => resolve(result))
                .catch(error => reject(error))
        }).catch(error => {
            console.error(error);
            getSinkID(amount, asset, sinkList)
                .then(result => resolve(result))
                .catch(error => reject(error))
        });
    })
}

function sendTx(floID, coin, amount, sinkID, sinkKey) {
    switch (coin) {
        case "FLO":
            return floBlockchainAPI.sendTx(sinkID, floID, amount, sinkKey, WITHDRAWAL_MESSAGE);
        case "BTC":
    }
}

function sendCoin(floID, coin, amount, id) {
    getSinkID(amount, coin).then(sinkID => {
        let callback = (sinkKey) => {
            //Send Coin to user via blockchain API
            sendTx(floID, coin, amount, sinkID, sinkKey).then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE OutputCoin SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error)).finally(_ => {
                delete callbackCollection.Coin[id];
                balance_locked[sinkID][coin] -= amount;
            });
        }
        collectAndCall(sinkID, callback);
        callbackCollection.Coin[id] = callback;
        if (!(sinkID in balance_locked))
            balance_locked[sinkID] = {};
        balance_locked[sinkID][coin] = (balance_locked[sinkID][coin] || 0) + amount;
    }).catch(error => console.error(error))
}

function sendCoin_init(floID, coin, amount) {
    DB.query("INSERT INTO OutputCoin (floID, coin, amount, status) VALUES (?, ?, ?, ?)", [floID, coin, amount, "PENDING"])
        .then(result => sendCoin(floID, coin, amount, result.insertId))
        .catch(error => console.error(error))
}

function sendCoin_retry(floID, coin, amount, id) {
    if (id in callbackCollection.Coin)
        console.debug("A callback is already pending for this FLO transfer");
    else
        sendCoin(floID, coin, amount, id);
}

function sendToken(floID, token, amount, id) {
    getSinkID(amount, token).then(sinkID => {
        let callback = (sinkKey) => {
            //Send Token to user via token API
            floTokenAPI.sendToken(sinkKey, amount, floID, WITHDRAWAL_MESSAGE, token).then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE OutputToken SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error)).finally(_ => {
                delete callbackCollection.token[id];
                balance_locked[sinkID][token] -= amount;
            });
        }
        collectAndCall(sinkID, callback);
        callbackCollection.token[id] = callback;
        if (!(sinkID in balance_locked))
            balance_locked[sinkID] = {};
        balance_locked[sinkID][token] = (balance_locked[sinkID][token] || 0) + amount;
    }).catch(error => console.error(error))
}

function sendToken_init(floID, token, amount) {
    DB.query("INSERT INTO OutputToken (floID, token, amount, status) VALUES (?, ?, ?, ?)", [floID, token, amount, "PENDING"])
        .then(result => sendToken(floID, amount, result.insertId))
        .catch(error => console.error(error))
}

function sendToken_retry(floID, token, amount, id) {
    if (id in callbackCollection.token)
        console.debug("A callback is already pending for this token transfer");
    else
        sendToken(floID, token, amount, id);
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
    }
}