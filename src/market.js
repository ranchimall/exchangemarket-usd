'use strict';

const coupling = require('./coupling');
const blockchain = require('./blockchain');

const {
    PERIOD_INTERVAL,
    WAIT_TIME,
    LAUNCH_SELLER_TAG,
    MAXIMUM_LAUNCH_SELL_CHIPS,
    TRADE_HASH_PREFIX,
    TRANSFER_HASH_PREFIX
} = require('./_constants')["market"];

const eCode = require('../docs/scripts/floExchangeAPI').errorCode;

const updateBalance = coupling.updateBalance;

var DB, assetList; //container for database and allowed assets

function login(floID, proxyKey) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO UserSession (floID, proxyKey) VALUE (?, ?) " +
                "ON DUPLICATE KEY UPDATE session_time=DEFAULT, proxyKey=?",
                [floID, proxyKey, proxyKey])
            .then(result => resolve("Login Successful"))
            .catch(error => reject(error))
    })
}

function logout(floID) {
    return new Promise((resolve, reject) => {
        DB.query("DELETE FROM UserSession WHERE floID=?", [floID])
            .then(result => resolve("Logout successful"))
            .catch(error => reject(error))
    })
}

function getRateHistory(asset, duration) {
    return new Promise((resolve, reject) => {
        if (!asset || !assetList.includes(asset))
            reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid asset(${asset})`));
        else
            coupling.price.getHistory(asset, duration)
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
}

function getBalance(floID, token) {
    return new Promise((resolve, reject) => {
        if (floID && !floCrypto.validateAddr(floID))
            reject(INVALID(eCode.INVALID_FLO_ID, `Invalid floID(${floID})`));
        else if (token && token !== floGlobals.currency && !assetList.includes(token))
            reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid token(${token})`));
        else if (!floID && !token)
            reject(INVALID(eCode.MISSING_PARAMETER, 'Missing parameters: requires atleast one (floID, token)'));
        else {
            var promise;
            if (floID && token)
                promise = getBalance.floID_token(floID, token);
            else if (floID)
                promise = getBalance.floID(floID);
            else if (token)
                promise = getBalance.token(token);
            promise.then(result => resolve(result)).catch(error => reject(error))
        }
    })
}

getBalance.floID_token = (floID, token) => new Promise((resolve, reject) => {
    DB.query("SELECT quantity AS balance FROM UserBalance WHERE floID=? AND token=?", [floID, token]).then(result => resolve({
        floID,
        token,
        balance: result.length ? result[0].balance.toFixed(8) : 0
    })).catch(error => reject(error))
});

getBalance.floID = (floID) => new Promise((resolve, reject) => {
    DB.query("SELECT token, quantity AS balance FROM UserBalance WHERE floID=?", [floID]).then(result => {
        let response = {
            floID,
            balance: {}
        };
        for (let row of result)
            response.balance[row.token] = row.balance.toFixed(8);
        resolve(response);
    }).catch(error => reject(error))
});

getBalance.token = (token) => new Promise((resolve, reject) => {
    DB.query("SELECT floID, quantity AS balance FROM UserBalance WHERE token=?", [token]).then(result => {
        let response = {
            token: token,
            balance: {}
        };
        for (let row of result)
            response.balance[row.floID] = row.balance.toFixed(8);
        resolve(response);
    }).catch(error => reject(error))
});

const getAssetBalance = (floID, asset) => new Promise((resolve, reject) => {
    let promises = [];
    promises.push(DB.query("SELECT IFNULL(SUM(quantity), 0) AS balance FROM UserBalance WHERE floID=? AND token=?", [floID, asset]));
    promises.push(asset === floGlobals.currency ?
        DB.query("SELECT IFNULL(SUM(quantity*maxPrice), 0) AS locked FROM BuyOrder WHERE floID=?", [floID]) :
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS locked FROM SellOrder WHERE floID=? AND asset=?", [floID, asset])
    );
    Promise.all(promises).then(result => resolve({
        total: result[0][0].balance,
        locked: result[1][0].locked,
        net: result[0][0].balance - result[1][0].locked
    })).catch(error => reject(error))
});

getAssetBalance.check = (floID, asset, amount) => new Promise((resolve, reject) => {
    getAssetBalance(floID, asset).then(balance => {
        if (balance.total < amount)
            reject(INVALID(eCode.INSUFFICIENT_BALANCE, `Insufficient ${asset}`));
        else if (balance.net < amount)
            reject(INVALID(eCode.INSUFFICIENT_BALANCE, `Insufficient ${asset} (Some are locked in orders)`));
        else
            resolve(true);
    }).catch(error => reject(error))
});

function addSellOrder(floID, asset, quantity, min_price) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(eCode.INVALID_FLO_ID, `Invalid floID (${floID})`));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid quantity (${quantity})`));
        else if (typeof min_price !== "number" || min_price <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid min_price (${min_price})`));
        else if (!assetList.includes(asset))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid asset (${asset})`));
        getAssetBalance.check(floID, asset, quantity).then(_ => {
            checkSellRequirement(floID, asset, quantity, min_price).then(_ => {
                DB.query("INSERT INTO SellOrder(floID, asset, quantity, minPrice) VALUES (?, ?, ?, ?)", [floID, asset, quantity, min_price]).then(result => {
                    resolve('Sell Order placed successfully');
                    coupling.initiate(asset);
                }).catch(error => reject(error));
            }).catch(error => reject(error))
        }).catch(error => reject(error));
    });
}

const checkSellRequirement = (floID, asset, quantity, min_price) => new Promise((resolve, reject) => {
    Promise.all([
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS total_chips FROM SellChips WHERE floID=? AND asset=?", [floID, asset]),
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS locked FROM SellOrder WHERE floID=? AND asset=?", [floID, asset])
    ]).then(result => {
        let total = result[0][0].total_chips,
            locked = result[1][0].locked;
        if (total < locked + quantity)
            reject(INVALID(eCode.INSUFFICIENT_SELLCHIP, `Insufficient sell-chips for ${asset}`));
        else Promise.all([
            DB.query("SELECT IFNULL(SUM(quantity), 0) AS total_chips FROM SellChips WHERE floID=? AND asset=? AND base<=?", [floID, asset, min_price]),
            DB.query("SELECT IFNULL(SUM(quantity), 0) AS locked FROM SellOrder WHERE floID=? AND asset=? AND minPrice<=?", [floID, asset, min_price])
        ]).then(result => {
            let g_total = result[0][0].total_chips,
                g_locked = result[1][0].locked;
            let l_total = total - g_total,
                l_locked = locked - g_locked;
            var rem = g_total - g_locked;
            if (l_locked > l_total)
                rem -= l_locked - l_total;
            if (rem < quantity)
                reject(INVALID(eCode.GREATER_SELLCHIP_BASE, `Cannot sell below purchased price`));
            else
                resolve(true);
        }).catch(error => reject(error))
    }).catch(error => reject(error))
});

function addBuyOrder(floID, asset, quantity, max_price) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(eCode.INVALID_FLO_ID, `Invalid floID (${floID})`));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid quantity (${quantity})`));
        else if (typeof max_price !== "number" || max_price <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid max_price (${max_price})`));
        else if (!assetList.includes(asset))
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid asset (${asset})`));
        getAssetBalance.check(floID, floGlobals.currency, quantity * max_price).then(_ => {
            DB.query("INSERT INTO BuyOrder(floID, asset, quantity, maxPrice) VALUES (?, ?, ?, ?)", [floID, asset, quantity, max_price]).then(result => {
                resolve('Buy Order placed successfully');
                coupling.initiate(asset);
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function cancelOrder(type, id, floID) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(eCode.INVALID_FLO_ID, `Invalid floID (${floID})`));
        let tableName;
        if (type === "buy")
            tableName = "BuyOrder";
        else if (type === "sell")
            tableName = "SellOrder";
        else
            return reject(INVALID(eCode.INVALID_TYPE, "Invalid Order type! Order type must be buy (or) sell"));
        DB.query(`SELECT floID, asset FROM ${tableName} WHERE id=?`, [id]).then(result => {
            if (result.length < 1)
                return reject(INVALID(eCode.NOT_FOUND, "Order not found!"));
            else if (result[0].floID !== floID)
                return reject(INVALID(eCode.NOT_OWNER, "Order doesnt belong to the current user"));
            let asset = result[0].asset;
            //Delete the order 
            DB.query(`DELETE FROM ${tableName} WHERE id=?`, [id]).then(result => {
                resolve(tableName + "#" + id + " cancelled successfully");
                coupling.initiate(asset);
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function getAccountDetails(floID) {
    return new Promise((resolve, reject) => {
        let select = [];
        select.push(["token, quantity", "UserBalance"]);
        select.push(["id, asset, quantity, minPrice, time_placed", "SellOrder"]);
        select.push(["id, asset, quantity, maxPrice, time_placed", "BuyOrder"]);
        let promises = select.map(a => DB.query(`SELECT ${a[0]} FROM ${a[1]} WHERE floID=? ${a[2] || ""}`, [floID]));
        Promise.allSettled(promises).then(results => {
            let response = {
                floID: floID,
                time: Date.now()
            };
            results.forEach((a, i) => {
                if (a.status === "rejected")
                    console.error(a.reason);
                else
                    switch (i) {
                        case 0:
                            response.tokenBalance = a.value;
                            break;
                        case 1:
                            response.sellOrders = a.value;
                            break;
                        case 2:
                            response.buyOrders = a.value;
                            break;
                    }
            });
            DB.query("SELECT * FROM TradeTransactions WHERE seller=? OR buyer=?", [floID, floID])
                .then(result => response.transactions = result)
                .catch(error => console.error(error))
                .finally(_ => resolve(response));
        });
    });
}

function getUserTransacts(floID) {
    return new Promise((resolve, reject) => {
        DB.query("(SELECT 'deposit' as type, txid, token, amount, status FROM InputToken WHERE floID=?)" +
                "UNION (SELECT 'deposit' as type, txid, 'FLO' as token, amount, status FROM InputFLO WHERE floID=?)" +
                "UNION (SELECT 'withdraw' as type, txid, token, amount, status FROM OutputToken WHERE floID=?)" +
                "UNION (SELECT 'withdraw' as type, txid, 'FLO' as token, amount, status FROM OutputFLO WHERE floID=?)",
                [floID, floID, floID, floID])
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
}

function getTransactionDetails(txid) {
    return new Promise((resolve, reject) => {
        let tableName, type;
        if (txid.startsWith(TRANSFER_HASH_PREFIX)) {
            tableName = 'TransferTransactions';
            type = 'transfer';
        } else if (txid.startsWith(TRADE_HASH_PREFIX)) {
            tableName = 'TradeTransactions';
            type = 'trade';
        } else
            return reject(INVALID(eCode.INVALID_TX_ID, "Invalid TransactionID"));
        DB.query(`SELECT * FROM ${tableName} WHERE txid=?`, [txid]).then(result => {
            if (result.length) {
                let details = result[0];
                details.type = type;
                if (tableName === 'TransferTransactions') //As json object is stored for receiver in transfer (to support one-to-many)
                    details.receiver = JSON.parse(details.receiver);
                resolve(details);
            } else
                reject(INVALID(eCode.NOT_FOUND, "Transaction not found"));
        }).catch(error => reject(error))
    })
}

function transferToken(sender, receivers, token) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(sender))
            reject(INVALID(eCode.INVALID_FLO_ID, `Invalid sender (${sender})`));
        else if (token !== floGlobals.currency && !assetList.includes(token))
            reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid token (${token})`));
        else {
            let invalidIDs = [],
                totalAmount = 0;
            for (let floID in receivers)
                if (!floCrypto.validateAddr(floID))
                    invalidIDs.push(floID);
                else
                    totalAmount += receivers[floID];
            if (invalidIDs.length)
                reject(INVALID(eCode.INVALID_FLO_ID, `Invalid receiver (${invalidIDs})`));
            else getAssetBalance.check(sender, token, totalAmount).then(_ => {
                let txQueries = [];
                txQueries.push(updateBalance.consume(sender, token, totalAmount));
                for (let floID in receivers)
                    txQueries.push(updateBalance.add(floID, token, receivers[floID]));
                checkDistributor(sender, token).then(result => {
                    if (result)
                        for (let floID in receivers)
                            txQueries.push(["INSERT INTO SellChips (floID, asset, quantity) VALUES (?, ?, ?)", [floID, token, receivers[floID]]]);
                    let time = Date.now();
                    let hash = TRANSFER_HASH_PREFIX + Crypto.SHA256(JSON.stringify({
                        sender: sender,
                        receiver: receivers,
                        token: token,
                        totalAmount: totalAmount,
                        tx_time: time,
                    }));
                    txQueries.push([
                        "INSERT INTO TransferTransactions (sender, receiver, token, totalAmount, tx_time, txid) VALUE (?, ?, ?, ?, ?, ?)",
                        [sender, JSON.stringify(receivers), token, totalAmount, global.convertDateToString(time), hash]
                    ]);
                    DB.transaction(txQueries)
                        .then(result => resolve(hash))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        }
    })
}

function depositFLO(floID, txid) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT status FROM InputFLO WHERE txid=? AND floID=?", [txid, floID]).then(result => {
            if (result.length) {
                switch (result[0].status) {
                    case "PENDING":
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
                    case "REJECTED":
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already rejected"));
                    case "SUCCESS":
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already used to add coins"));
                }
            } else
                DB.query("INSERT INTO InputFLO(txid, floID, status) VALUES (?, ?, ?)", [txid, floID, "PENDING"])
                .then(result => resolve("Deposit request in process"))
                .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function confirmDepositFLO() {
    DB.query("SELECT id, floID, txid FROM InputFLO WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            confirmDepositFLO.checkTx(req.floID, req.txid).then(amount => {
                confirmDepositFLO.addSellChipsIfLaunchSeller(req.floID, amount).then(txQueries => {
                    txQueries.push(updateBalance.add(req.floID, "FLO", amount));
                    txQueries.push(["UPDATE InputFLO SET status=?, amount=? WHERE id=?", ["SUCCESS", amount, req.id]]);
                    DB.transaction(txQueries)
                        .then(result => console.debug("FLO deposited:", req.floID, amount))
                        .catch(error => console.error(error))
                }).catch(error => console.error(error))
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE InputFLO SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

confirmDepositFLO.checkTx = function(sender, txid) {
    return new Promise((resolve, reject) => {
        floBlockchainAPI.getTx(txid).then(tx => {
            let vin_sender = tx.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            if (vin_sender.length !== tx.vin.length)
                return reject([true, "Transaction input containes other floIDs"]);
            if (!tx.blockheight)
                return reject([false, "Transaction not included in any block yet"]);
            if (!tx.confirmations)
                return reject([false, "Transaction not confirmed yet"]);
            let amount = tx.vout.reduce((a, v) => blockchain.chest.includes(v.scriptPubKey.addresses[0]) ? a + v.value : a, 0);
            if (amount == 0)
                return reject([true, "Transaction receiver is not market ID"]); //Maybe reject as false? (to compensate delay in chestList loading from other nodes)
            else
                resolve(amount);
        }).catch(error => reject([false, error]))
    })
}

confirmDepositFLO.addSellChipsIfLaunchSeller = function(floID, quantity) {
    return new Promise((resolve, reject) => {
        checkTag(floID, LAUNCH_SELLER_TAG).then(result => {
            if (result) //floID is launch-seller
                Promise.all([
                    DB.query("SELECT IFNULL(SUM(quantity), 0) AS sold FROM TradeTransactions WHERE seller=? AND asset=?", [floID, 'FLO']),
                    DB.query("SELECT IFNULL(SUM(quantity), 0) AS brought FROM TradeTransactions WHERE buyer=? AND asset=?", [floID, 'FLO']),
                    DB.query("SELECT IFNULL(SUM(quantity), 0) AS chips FROM SellChips WHERE floID=? AND asset=?", [floID, 'FLO']),
                ]).then(result => {
                    let sold = result[0][0].sold,
                        brought = result[1][0].brought,
                        chips = result[2][0].chips;
                    let remLaunchChips = MAXIMUM_LAUNCH_SELL_CHIPS - (sold + chips) + brought;
                    quantity = Math.min(quantity, remLaunchChips);
                    if (quantity > 0)
                        resolve([
                            ["INSERT INTO SellChips(floID, asset, quantity) VALUES (?, ?, ?)", [floID, 'FLO', quantity]]
                        ]);
                    else
                        resolve([]);
                }).catch(error => reject(error))
            else //floID is not launch-seller
                resolve([]);
        }).catch(error => reject(error))
    })
}

function withdrawFLO(floID, amount) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(eCode.INVALID_FLO_ID, `Invalid floID (${floID})`));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid amount (${amount})`));
        getAssetBalance.check(floID, "FLO", amount).then(_ => {
            let txQueries = [];
            txQueries.push(updateBalance.consume(floID, "FLO", amount));
            DB.transaction(txQueries).then(result => {
                blockchain.sendFLO(floID, amount);
                resolve("Withdrawal request is in process");
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function retryWithdrawalFLO() {
    DB.query("SELECT id, floID, amount FROM OutputFLO WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => blockchain.resendFLO(req.floID, req.amount))
    }).catch(error => reject(error));
}

function confirmWithdrawalFLO() {
    DB.query("SELECT id, floID, amount, txid FROM OutputFLO WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.getTx(req.txid).then(tx => {
                if (!tx.blockheight || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE OutputFLO SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("FLO withdrawed:", req.floID, req.amount))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function depositToken(floID, txid) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT status FROM InputToken WHERE txid=? AND floID=?", [txid, floID]).then(result => {
            if (result.length) {
                switch (result[0].status) {
                    case "PENDING":
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already in process"));
                    case "REJECTED":
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already rejected"));
                    case "SUCCESS":
                        return reject(INVALID(eCode.DUPLICATE_ENTRY, "Transaction already used to add tokens"));
                }
            } else
                DB.query("INSERT INTO InputToken(txid, floID, status) VALUES (?, ?, ?)", [txid, floID, "PENDING"])
                .then(result => resolve("Deposit request in process"))
                .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function confirmDepositToken() {
    DB.query("SELECT id, floID, txid FROM InputToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            confirmDepositToken.checkTx(req.floID, req.txid).then(amounts => {
                DB.query("SELECT id FROM InputFLO where floID=? AND txid=?", [req.floID, req.txid]).then(result => {
                    let txQueries = [],
                        token_name = amounts[0],
                        amount_token = amounts[1];
                    //Add the FLO balance if necessary
                    if (!result.length) {
                        let amount_flo = amounts[2];
                        txQueries.push(updateBalance.add(req.floID, "FLO", amount_flo));
                        txQueries.push(["INSERT INTO InputFLO(txid, floID, amount, status) VALUES (?, ?, ?, ?)", [req.txid, req.floID, amount_flo, "SUCCESS"]]);
                    }
                    txQueries.push(["UPDATE InputToken SET status=?, token=?, amount=? WHERE id=?", ["SUCCESS", token_name, amount_token, req.id]]);
                    txQueries.push(updateBalance.add(req.floID, token_name, amount_token));
                    DB.transaction(txQueries)
                        .then(result => console.debug("Token deposited:", req.floID, token_name, amount_token))
                        .catch(error => console.error(error));
                }).catch(error => console.error(error));
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE InputToken SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

confirmDepositToken.checkTx = function(sender, txid) {
    return new Promise((resolve, reject) => {
        floTokenAPI.getTx(txid).then(tx => {
            if (tx.parsedFloData.type !== "transfer")
                return reject([true, "Transaction type not 'transfer'"]);
            else if (tx.parsedFloData.transferType !== "token")
                return reject([true, "Transaction transfer is not 'token'"]);
            var token_name = tx.parsedFloData.tokenIdentification,
                amount_token = tx.parsedFloData.tokenAmount;
            if ((!assetList.includes(token_name) && token_name !== floGlobals.currency) || token_name === "FLO")
                return reject([true, "Token not authorised"]);
            let vin_sender = tx.transactionDetails.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            let amount_flo = tx.transactionDetails.vout.reduce((a, v) => blockchain.chest.includes(v.scriptPubKey.addresses[0]) ? a + v.value : a, 0);
            if (amount_flo == 0)
                return reject([true, "Transaction receiver is not market ID"]); //Maybe reject as false? (to compensate delay in chestList loading from other nodes)
            else
                resolve([token_name, amount_token, amount_flo]);
        }).catch(error => reject([false, error]))
    })
}

function withdrawToken(floID, token, amount) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(eCode.INVALID_FLO_ID, `Invalid floID (${floID})`));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(eCode.INVALID_NUMBER, `Invalid amount (${amount})`));
        else if ((!assetList.includes(token) && token !== floGlobals.currency) || token === "FLO")
            return reject(INVALID(eCode.INVALID_TOKEN_NAME, "Invalid Token"));
        //Check for FLO balance (transaction fee)
        let required_flo = floGlobals.sendAmt + floGlobals.fee;
        getAssetBalance.check(floID, "FLO", required_flo).then(_ => {
            getAssetBalance.check(floID, token, amount).then(_ => {
                let txQueries = [];
                txQueries.push(updateBalance.consume(floID, "FLO", required_flo));
                txQueries.push(updateBalance.consume(floID, token, amount));
                DB.transaction(txQueries).then(result => {
                    //Send Token to user via token API
                    blockchain.sendToken(floID, token, amount);
                    resolve("Withdrawal request is in process");
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function retryWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount FROM OutputToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => blockchain.resendToken(req.floID, req.token, req.amount));
    }).catch(error => reject(error));
}

function confirmWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount, txid FROM OutputToken WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floTokenAPI.getTx(req.txid).then(tx => {
                DB.query("UPDATE OutputToken SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("Token withdrawed:", req.floID, req.token, req.amount))
                    .catch(error => console.error(error));
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function addTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO UserTag (floID, tag) VALUE (?,?)", [floID, tag])
            .then(result => resolve(`Added ${floID} to ${tag}`))
            .catch(error => {
                if (error.code === "ER_DUP_ENTRY")
                    reject(INVALID(eCode.DUPLICATE_ENTRY, `${floID} already in ${tag}`));
                else if (error.code === "ER_NO_REFERENCED_ROW")
                    reject(INVALID(eCode.INVALID_TAG, `Invalid Tag`));
                else
                    reject(error);
            });
    });
}

function removeTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("DELETE FROM UserTag WHERE floID=? AND tag=?", [floID, tag])
            .then(result => resolve(`Removed ${floID} from ${tag}`))
            .catch(error => reject(error));
    })
}

function checkTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id FROM UserTag WHERE floID=? AND tag=?", [floID, tag])
            .then(result => resolve(result.length ? true : false))
            .catch(error => reject(error))
    })
}

function addDistributor(floID, asset) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO Distributors (floID, asset) VALUE (?,?)", [floID, asset])
            .then(result => resolve(`Added ${asset} distributor: ${floID}`))
            .catch(error => {
                if (error.code === "ER_DUP_ENTRY")
                    reject(INVALID(eCode.DUPLICATE_ENTRY, `${floID} is already ${asset} disributor`));
                else if (error.code === "ER_NO_REFERENCED_ROW")
                    reject(INVALID(eCode.INVALID_TOKEN_NAME, `Invalid Asset`));
                else
                    reject(error);
            });
    });
}

function removeDistributor(floID, asset) {
    return new Promise((resolve, reject) => {
        DB.query("DELETE FROM Distributors WHERE floID=? AND tag=?", [floID, asset])
            .then(result => resolve(`Removed ${asset} distributor: ${floID}`))
            .catch(error => reject(error));
    })
}

function checkDistributor(floID, asset) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id FROM Distributors WHERE floID=? AND asset=?", [floID, asset])
            .then(result => resolve(result.length ? true : false))
            .catch(error => reject(error))
    })
}

function periodicProcess() {
    blockchainReCheck();
}

periodicProcess.start = function() {
    periodicProcess.stop();
    periodicProcess();
    assetList.forEach(asset => coupling.initiate(asset, true));
    coupling.price.storeHistory.start();
    periodicProcess.instance = setInterval(periodicProcess, PERIOD_INTERVAL);
};

periodicProcess.stop = function() {
    if (periodicProcess.instance !== undefined) {
        clearInterval(periodicProcess.instance);
        delete periodicProcess.instance;
    }
    coupling.stopAll();
    coupling.price.storeHistory.stop();
};

var lastSyncBlockHeight = 0;

function blockchainReCheck() {
    if (blockchainReCheck.timeout !== undefined) {
        clearTimeout(blockchainReCheck.timeout);
        delete blockchainReCheck.timeout;
    }
    if (!blockchain.chest.list.length)
        return blockchainReCheck.timeout = setTimeout(blockchainReCheck, WAIT_TIME);

    floBlockchainAPI.promisedAPI('api/blocks?limit=1').then(result => {
        if (lastSyncBlockHeight < result.blocks[0].height) {
            lastSyncBlockHeight = result.blocks[0].height;
            confirmDepositFLO();
            confirmDepositToken();
            retryWithdrawalFLO();
            retryWithdrawalToken();
            confirmWithdrawalFLO();
            confirmWithdrawalToken();
            console.debug("Last Block :", lastSyncBlockHeight);
        }
    }).catch(error => console.error(error));
}

module.exports = {
    login,
    logout,
    get rates() {
        return coupling.price.currentRates;
    },
    get priceCountDown() {
        return coupling.price.lastTimes;
    },
    get chest() {
        return blockchain.chest;
    },
    set chest(c) {
        blockchain.chest = c;
    },
    addBuyOrder,
    addSellOrder,
    cancelOrder,
    getRateHistory,
    getBalance,
    getAccountDetails,
    getUserTransacts,
    getTransactionDetails,
    transferToken,
    depositFLO,
    withdrawFLO,
    depositToken,
    withdrawToken,
    addTag,
    removeTag,
    addDistributor,
    removeDistributor,
    periodicProcess,
    set DB(db) {
        DB = db;
        coupling.DB = db;
    },
    set assetList(assets) {
        assetList = assets;
    },
    get assetList() {
        return assetList
    },
    set collectAndCall(fn) {
        blockchain.collectAndCall = fn;
    },
};