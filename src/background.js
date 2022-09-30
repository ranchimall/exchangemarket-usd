'use strict';
const blockchain = require('./blockchain');

const {
    LAUNCH_SELLER_TAG,
    MAXIMUM_LAUNCH_SELL_CHIPS,
} = require('./_constants')["market"];

function checkTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id FROM UserTag WHERE floID=? AND tag=?", [floID, tag])
            .then(result => resolve(result.length ? true : false))
            .catch(error => reject(error))
    })
}

function confirmDepositFLO() {
    DB.query("SELECT id, floID, txid FROM InputCoin WHERE coin=? AND status=?", ["FLO", "PENDING"]).then(results => {
        results.forEach(req => {
            verifyDepositFLO(req.floID, req.txid).then(amount => {
                addSellChipsIfLaunchSeller(req.floID, amount).then(txQueries => {
                    txQueries.push(updateBalance.add(req.floID, "FLO", amount));
                    txQueries.push(["UPDATE InputCoin SET status=?, amount=? WHERE id=?", ["SUCCESS", amount, req.id]]);
                    DB.transaction(txQueries)
                        .then(result => console.debug("FLO deposited:", req.floID, amount))
                        .catch(error => console.error(error))
                }).catch(error => console.error(error))
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE InputCoin SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

function verifyDepositFLO(sender, txid) {
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
            let amount = tx.vout.reduce((a, v) => blockchain.chests.includes(v.scriptPubKey.addresses[0]) ? a + v.value : a, 0);
            if (amount == 0)
                return reject([true, "Transaction receiver is not market ID"]); //Maybe reject as false? (to compensate delay in chestsList loading from other nodes)
            else
                resolve(amount);
        }).catch(error => reject([false, error]))
    })
}

function addSellChipsIfLaunchSeller(floID, quantity) {
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

function confirmDepositToken() {
    DB.query("SELECT id, floID, txid FROM InputToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            verifyDepositToken(req.floID, req.txid).then(amounts => {
                DB.query("SELECT id FROM InputCoin where floID=? AND coin=? AND txid=?", [req.floID, "FLO", req.txid]).then(result => {
                    let txQueries = [],
                        token_name = amounts[0],
                        amount_token = amounts[1];
                    //Add the FLO balance if necessary
                    if (!result.length) {
                        let amount_flo = amounts[2];
                        txQueries.push(updateBalance.add(req.floID, "FLO", amount_flo));
                        txQueries.push(["INSERT INTO InputCoin(txid, floID, coin, amount, status) VALUES (?, ?, ?, ?, ?)", [req.txid, req.floID, "FLO", amount_flo, "SUCCESS"]]);
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

function verifyDepositToken(sender, txid) {
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
            let amount_flo = tx.transactionDetails.vout.reduce((a, v) => blockchain.chests.includes(v.scriptPubKey.addresses[0]) ? a + v.value : a, 0);
            if (amount_flo == 0)
                return reject([true, "Transaction receiver is not market ID"]); //Maybe reject as false? (to compensate delay in chestsList loading from other nodes)
            else
                resolve([token_name, amount_token, amount_flo]);
        }).catch(error => reject([false, error]))
    })
}

function retryWithdrawalCoin() {
    DB.query("SELECT id, floID, coin, amount FROM OutputCoin WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => blockchain.sendCoin.retry(req.floID, req.coin, req.amount, req.id));
    }).catch(error => reject(error));
}

function retryWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount FROM OutputToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => blockchain.sendToken.retry(req.floID, req.token, req.amount, req.id));
    }).catch(error => reject(error));
}

function confirmWithdrawalFLO() {
    DB.query("SELECT id, floID, amount, txid FROM OutputCoin WHERE coin=? AND status=?", ["FLO", "WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.getTx(req.txid).then(tx => {
                if (!tx.blockheight || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE OutputCoin SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("FLO withdrawed:", req.floID, req.amount))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function confirmWithdrawalBTC() {
    DB.query("SELECT id, floID, amount, txid FROM OutputCoin WHERE coin=? AND status=?", ["BTC", "WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            btcOperator.getTx(req.txid).then(tx => {
                if (!tx.blockhash || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE OutputCoin SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("BTC withdrawed:", req.floID, req.amount))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
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

module.exports = {
    blockchain,
    confirmDepositFLO,
    confirmDepositToken,
    retryWithdrawalCoin,
    retryWithdrawalToken,
    confirmWithdrawalFLO,
    confirmWithdrawalBTC,
    confirmWithdrawalToken
}