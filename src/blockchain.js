'use strict';

var collectAndCall; //container for collectAndCall function from backup module
var chests; //container for blockchain ids (where assets are stored)

const balance_locked = {},
    balance_cache = {},
    callbackCollection = {
        FLO: {},
        token: {}
    };

function getSinkID(amount, asset = "FLO", sinkList = null) {
    return new Promise((resolve, reject) => {
        if (!sinkList)
            sinkList = chests.list.map(s => [s, s in balance_cache ? balance_cache[s][asset] || 0 : 0]) //TODO: improve sorting
            .sort((a, b) => b[1] - a[1]).map(x => x[0]);
        if (!sinkList.length)
            return reject(`Insufficient balance in chests for asset(${asset})`);
        let sinkID = sinkList.shift();
        (asset === "FLO" ? floBlockchainAPI.getBalance(sinkID) : floTokenAPI.getBalance(sinkID, asset)).then(balance => {
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

function sendFLO(floID, amount, id) {
    getSinkID(amount).then(sinkID => {
        let callback = (sinkKey) => {
            //Send FLO to user via blockchain API
            floBlockchainAPI.sendTx(sinkID, floID, amount, sinkKey, '(withdrawal from market)').then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE OutputFLO SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error)).finally(_ => {
                delete callbackCollection.FLO[id];
                balance_locked[sinkID].FLO -= amount;
            });
        }
        collectAndCall(sinkID, callback);
        callbackCollection.FLO[id] = callback;
        if (!(sinkID in balance_locked))
            balance_locked[sinkID] = {};
        balance_locked[sinkID].FLO = (balance_locked[sinkID].FLO || 0) + amount;
    }).catch(error => console.error(error))
}

function sendFLO_init(floID, amount) {
    DB.query("INSERT INTO OutputFLO (floID, amount, status) VALUES (?, ?, ?)", [floID, amount, "PENDING"])
        .then(result => sendFLO(floID, amount, result.insertId))
        .catch(error => console.error(error))
}

function sendFLO_retry(floID, amount, id) {
    if (id in callbackCollection.FLO)
        console.debug("A callback is already pending for this FLO transfer");
    else
        sendFLO(floID, amount, id);
}

function sendToken(floID, token, amount, id) {
    getSinkID(amount, token).then(sinkID => {
        let callback = (sinkKey) => {
            //Send Token to user via token API
            floTokenAPI.sendToken(sinkKey, amount, floID, '(withdrawal from market)', token).then(txid => {
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

function sendToken_init() {
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
    sendFLO: {
        init: sendFLO_init,
        retry: sendFLO_retry
    },
    sendToken: {
        init: sendToken_init,
        retry: sendToken_retry
    }
}