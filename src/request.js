'use strict';

const market = require("./market");

const {
    SIGN_EXPIRE_TIME,
    MAX_SESSION_TIMEOUT,
    INVALID_SERVER_MSG
} = require("./_constants")["request"];

var DB, trustedIDs, secret; //container for database

global.INVALID = function(message) {
    if (!(this instanceof INVALID))
        return new INVALID(message);
    this.message = message;
}
INVALID.e_code = 400;

global.INTERNAL = function INTERNAL(message) {
    if (!(this instanceof INTERNAL))
        return new INTERNAL(message);
    this.message = message;
}
INTERNAL.e_code = 500;

var serving;

function validateRequest(request, sign, floID, pubKey) {
    return new Promise((resolve, reject) => {
        if (!serving)
            reject(INVALID(INVALID_SERVER_MSG));
        else if (!request.timestamp)
            reject(INVALID("Timestamp parameter missing"));
        else if (Date.now() - SIGN_EXPIRE_TIME > request.timestamp)
            reject(INVALID("Signature Expired"));
        else if (!floCrypto.validateAddr(floID))
            reject(INVALID("Invalid floID"));
        else if (typeof request !== "object")
            reject(INVALID("Request is not an object"));
        else validateRequest.getSignKey(floID, pubKey).then(signKey => {
            let req_str = Object.keys(request).sort().map(r => r + ":" + request[r]).join("|");
            try {
                if (!floCrypto.verifySign(req_str, sign, signKey))
                    reject(INVALID("Invalid request signature! Re-login if this error occurs frequently"));
                else validateRequest.checkIfSignUsed(sign)
                    .then(result => resolve(req_str))
                    .catch(error => reject(error))
            } catch {
                reject(INVALID("Corrupted sign/key"));
            }
        }).catch(error => reject(error));
    });
}

validateRequest.getSignKey = (floID, pubKey) => new Promise((resolve, reject) => {
    if (!pubKey)
        DB.query("SELECT session_time, proxyKey FROM UserSession WHERE floID=?", [floID]).then(result => {
            if (result.length < 1)
                reject(INVALID("Session not active"));
            else if (result[0].session_time + MAX_SESSION_TIMEOUT < Date.now())
                reject(INVALID("Session Expired! Re-login required"));
            else
                resolve(result[0].proxyKey);
        }).catch(error => reject(error));
    else if (floCrypto.getFloID(pubKey) === floID)
        resolve(pubKey);
    else
        reject(INVALID("Invalid pubKey"));
});

validateRequest.checkIfSignUsed = sign => new Promise((resolve, reject) => {
    DB.query("SELECT id FROM RequestLog WHERE sign=?", [sign]).then(result => {
        if (result.length)
            reject(INVALID("Duplicate signature"));
        else
            resolve(true);
    }).catch(error => reject(error))
});

function logRequest(floID, req_str, sign, proxy = false) {
    //console.debug(floID, req_str);
    DB.query("INSERT INTO RequestLog (floID, request, sign, proxy) VALUES (?,?,?, ?)", [floID, req_str, sign, proxy])
        .then(_ => null).catch(error => console.error(error));
}

function processRequest(res, rText, validateObj, sign, floID, pubKey, marketFn) {
    validateRequest(validateObj, sign, floID, pubKey).then(req_str => {
        marketFn().then(result => {
            logRequest(floID, req_str, sign, !pubKey);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send(rText + " failed! Try again later!");
            }
        })
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    })
}

/* User Requests */

function Account(req, res) {
    let data = req.body;
    validateRequest({
        type: "get_account",
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.getAccountDetails(data.floID).then(result => {
            result.sinkID = global.sinkID;
            if (trustedIDs.includes(data.floID))
                result.subAdmin = true;
            res.send(result);
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function Login(req, res) {
    let data = req.body;
    if (!data.code || data.hash != Crypto.SHA1(data.code + secret))
        res.status(INVALID.e_code).send("Invalid Code");
    else if (!data.pubKey)
        res.status(INVALID.e_code).send("Public key missing");
    else
        processRequest(res, "Login", {
                type: "login",
                random: data.code,
                proxyKey: data.proxyKey,
                timestamp: data.timestamp
            }, data.sign, data.floID, data.pubKey,
            () => market.login(data.floID, data.proxyKey)
        );
}

function Logout(req, res) {
    let data = req.body;
    processRequest(res, "Logout", {
            type: "logout",
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.logout(data.floID)
    );
}

function PlaceSellOrder(req, res) {
    let data = req.body;
    processRequest(res, "Sell order placement", {
            type: "sell_order",
            asset: data.asset,
            quantity: data.quantity,
            min_price: data.min_price,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.addSellOrder(data.floID, data.asset, data.quantity, data.min_price)
    );
}

function PlaceBuyOrder(req, res) {
    let data = req.body;
    processRequest(res, "Buy order placement", {
            type: "buy_order",
            asset: data.asset,
            quantity: data.quantity,
            max_price: data.max_price,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.addBuyOrder(data.floID, data.asset, data.quantity, data.max_price)
    );
}

function CancelOrder(req, res) {
    let data = req.body;
    processRequest(res, "Order cancellation", {
            type: "cancel_order",
            order: data.orderType,
            id: data.orderID,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.cancelOrder(data.orderType, data.orderID, data.floID)
    );
}

function TransferToken(req, res) {
    let data = req.body;
    processRequest(res, "Token Transfer", {
            type: "transfer_token",
            receiver: JSON.stringify(data.receiver),
            token: data.token,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.transferToken(data.floID, data.receiver, data.token)
    );
}

function DepositFLO(req, res) {
    let data = req.body;
    processRequest(res, "Deposit FLO", {
            type: "deposit_flo",
            txid: data.txid,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.depositFLO(data.floID, data.txid)
    );
}

function WithdrawFLO(req, res) {
    let data = req.body;
    processRequest(res, "Withdraw FLO", {
            type: "withdraw_flo",
            amount: data.amount,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.withdrawFLO(data.floID, data.amount)
    );
}

function DepositToken(req, res) {
    let data = req.body;
    processRequest(res, "Deposit Token", {
            type: "deposit_token",
            txid: data.txid,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.depositToken(data.floID, data.txid)
    );
}

function WithdrawToken(req, res) {
    let data = req.body;
    processRequest(res, "Withdraw Token", {
            type: "withdraw_token",
            token: data.token,
            amount: data.amount,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.withdrawToken(data.floID, data.token, data.amount)
    );
}

function AddUserTag(req, res) {
    let data = req.body;
    if (!trustedIDs.includes(data.floID))
        res.status(INVALID.e_code).send("Access Denied");
    else processRequest(res, "Add user-tag", {
            type: "add_tag",
            user: data.user,
            tag: data.tag,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.group.addTag(data.user, data.tag)
    );
}

function RemoveUserTag(req, res) {
    let data = req.body;
    if (!trustedIDs.includes(data.floID))
        res.status(INVALID.e_code).send("Access Denied");
    else processRequest(res, "Remove user-tag", {
            type: "remove_tag",
            user: data.user,
            tag: data.tag,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.group.removeTag(data.user, data.tag)
    );
}

function AddDistributor(req, res) {
    let data = req.body;
    if (!trustedIDs.includes(data.floID))
        res.status(INVALID.e_code).send("Access Denied");
    else processRequest(res, "Add distributor", {
            type: "add_distributor",
            distributor: data.distributor,
            asset: data.asset,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.group.addDistributor(data.distributor, data.asset)
    );
}

function RemoveDistributor(req, res) {
    let data = req.body;
    if (!trustedIDs.includes(data.floID))
        res.status(INVALID.e_code).send("Access Denied");
    else processRequest(res, "Remove distributor", {
            type: "remove_distributor",
            distributor: data.distributor,
            asset: data.asset,
            timestamp: data.timestamp
        }, data.sign, data.floID, data.pubKey,
        () => market.group.removeDistributor(data.distributor, data.asset)
    );
}

/* Public Requests */

function GetLoginCode(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let randID = floCrypto.randString(8, true) + Math.round(Date.now() / 1000);
        let hash = Crypto.SHA1(randID + secret);
        res.send({
            code: randID,
            hash: hash
        });
    }
}

function ListSellOrders(req, res) {
    //TODO: Limit size (best)
    DB.query("SELECT * FROM SellOrder ORDER BY time_placed")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function ListBuyOrders(req, res) {
    //TODO: Limit size (best)
    DB.query("SELECT * FROM BuyOrder ORDER BY time_placed")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function ListTradeTransactions(req, res) {
    //TODO: Limit size (recent)
    DB.query("SELECT * FROM TradeTransactions ORDER BY tx_time DESC")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function GetRates(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let asset = req.query.asset,
            rates = market.rates;
        if (asset) {
            if (asset in rates)
                res.send(rates[asset].toString());
            else
                res.status(INVALID.e_code).send("Invalid asset parameter");
        } else
            res.send(rates);
    }

}

function GetRateHistory(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let asset = req.query.asset,
            duration = req.query.duration || "";
        market.getRateHistory(asset, duration)
            .then(result => res.send(result))
            .catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Unable to process! Try again later!");
                }
            });
    }
}

function GetTransaction(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let txid = req.query.txid;
        if (!txid)
            res.status(INVALID.e_code).send("txid (transactionID) parameter missing");
        else market.getTransactionDetails(txid)
            .then(result => res.send(result))
            .catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Unable to process! Try again later!");
                }
            });
    }
}

function GetBalance(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let floID = req.query.floID || req.query.addr,
            token = req.query.token || req.query.asset;
        market.getBalance(floID, token)
            .then(result => res.send(result))
            .catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Unable to process! Try again later!");
                }
            });
    }
}

module.exports = {
    GetLoginCode,
    Login,
    Logout,
    PlaceBuyOrder,
    PlaceSellOrder,
    CancelOrder,
    TransferToken,
    ListSellOrders,
    ListBuyOrders,
    ListTradeTransactions,
    GetRates,
    GetRateHistory,
    GetTransaction,
    GetBalance,
    Account,
    DepositFLO,
    WithdrawFLO,
    DepositToken,
    WithdrawToken,
    periodicProcess: market.periodicProcess,
    AddUserTag,
    RemoveUserTag,
    AddDistributor,
    RemoveDistributor,
    set trustedIDs(ids) {
        trustedIDs = ids;
    },
    set assetList(assets) {
        market.assetList = assets;
    },
    set DB(db) {
        DB = db;
        market.DB = db;
    },
    set secret(s) {
        secret = s;
    },
    pause() {
        serving = false;
    },
    resume() {
        serving = true;
    }
};