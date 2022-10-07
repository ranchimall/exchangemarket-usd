'use strict';
const blockchain = require('./blockchain');
const conversion = require('./conversion');

const {
    LAUNCH_SELLER_TAG,
    MAXIMUM_LAUNCH_SELL_CHIPS,
} = require('./_constants')["market"];

const _sql = require('./_constants').sql;

var updateBalance; // container for updateBalance function

const verifyTx = {};

function confirmDepositFLO() {
    DB.query("SELECT id, floID, txid FROM DepositCoin WHERE coin=? AND status=?", ["FLO", "PENDING"]).then(results => {
        results.forEach(req => {
            verifyTx.FLO(req.floID, req.txid).then(amount => {
                addSellChipsIfLaunchSeller(req.floID, amount).then(txQueries => {
                    txQueries.push(updateBalance.add(req.floID, "FLO", amount));
                    txQueries.push(["UPDATE DepositCoin SET status=?, amount=? WHERE id=?", ["SUCCESS", amount, req.id]]);
                    DB.transaction(txQueries)
                        .then(result => console.debug("FLO deposited:", req.floID, amount))
                        .catch(error => console.error(error))
                }).catch(error => console.error(error))
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE DepositCoin SET status=? WHERE id=?", ["REJECTED", req.id])
                        .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

verifyTx.FLO = function (sender, txid) {
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

function checkTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id FROM UserTag WHERE floID=? AND tag=?", [floID, tag])
            .then(result => resolve(result.length ? true : false))
            .catch(error => reject(error))
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
                        resolve([["INSERT INTO SellChips(floID, asset, quantity) VALUES (?, ?, ?)", [floID, 'FLO', quantity]]]);
                    else
                        resolve([]);
                }).catch(error => reject(error))
            else //floID is not launch-seller
                resolve([]);
        }).catch(error => reject(error))
    })
}

function confirmDepositToken() {
    DB.query("SELECT id, floID, txid FROM DepositToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            verifyTx.token(req.floID, req.txid).then(({ token, amount, flo_amount }) => {
                DB.query("SELECT id FROM DepositCoin where floID=? AND coin=? AND txid=?", [req.floID, "FLO", req.txid]).then(result => {
                    let txQueries = [];
                    //Add the FLO balance if necessary
                    if (!result.length) {
                        txQueries.push(updateBalance.add(req.floID, "FLO", flo_amount));
                        txQueries.push(["INSERT INTO DepositCoin(txid, floID, coin, amount, status) VALUES (?, ?, ?, ?, ?)", [req.txid, req.floID, "FLO", flo_amount, "SUCCESS"]]);
                    }
                    txQueries.push(["UPDATE DepositToken SET status=?, token=?, amount=? WHERE id=?", ["SUCCESS", token, amount, req.id]]);
                    txQueries.push(updateBalance.add(req.floID, token, amount));
                    DB.transaction(txQueries)
                        .then(result => console.debug("Token deposited:", req.floID, token, amount))
                        .catch(error => console.error(error));
                }).catch(error => console.error(error));
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE DepositToken SET status=? WHERE id=?", ["REJECTED", req.id])
                        .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

verifyTx.token = function (sender, txid, currencyOnly = false) {
    return new Promise((resolve, reject) => {
        floTokenAPI.getTx(txid).then(tx => {
            if (tx.parsedFloData.type !== "transfer")
                return reject([true, "Transaction type not 'transfer'"]);
            else if (tx.parsedFloData.transferType !== "token")
                return reject([true, "Transaction transfer is not 'token'"]);
            var token = tx.parsedFloData.tokenIdentification,
                amount = tx.parsedFloData.tokenAmount;
            if (currencyOnly && token !== floGlobals.currency)
                return reject([true, "Token not currency"]);
            else if (!currencyOnly && ((!assetList.includes(token) && token !== floGlobals.currency) || token === "FLO"))
                return reject([true, "Token not authorised"]);
            let vin_sender = tx.transactionDetails.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            let flo_amount = tx.transactionDetails.vout.reduce((a, v) => blockchain.chests.includes(v.scriptPubKey.addresses[0]) ? a + v.value : a, 0);
            if (flo_amount == 0)
                return reject([true, "Transaction receiver is not market ID"]); //Maybe reject as false? (to compensate delay in chestsList loading from other nodes)
            else
                resolve({ token, amount, flo_amount });
        }).catch(error => reject([false, error]))
    })
}

function retryWithdrawalCoin() {
    DB.query("SELECT id, floID, coin, amount FROM WithdrawCoin WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => blockchain.sendCoin.retry(req.floID, req.coin, req.amount, req.id));
    }).catch(error => console.error(error));
}

function retryWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount FROM WithdrawToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => blockchain.sendToken.retry(req.floID, req.token, req.amount, req.id));
    }).catch(error => console.error(error));
}

function confirmWithdrawalFLO() {
    DB.query("SELECT id, floID, amount, txid FROM WithdrawCoin WHERE coin=? AND status=?", ["FLO", "WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.getTx(req.txid).then(tx => {
                if (!tx.blockheight || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE WithdrawCoin SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("FLO withdrawed:", req.floID, req.amount))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function confirmWithdrawalBTC() {
    DB.query("SELECT id, floID, amount, txid FROM WithdrawCoin WHERE coin=? AND status=?", ["BTC", "WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            btcOperator.getTx(req.txid).then(tx => {
                if (!tx.blockhash || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE WithdrawCoin SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("BTC withdrawed:", req.floID, req.amount))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function confirmWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount, txid FROM WithdrawToken WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floTokenAPI.getTx(req.txid).then(tx => {
                DB.query("UPDATE WithdrawToken SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("Token withdrawed:", req.floID, req.token, req.amount))
                    .catch(error => console.error(error));
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

verifyTx.BTC = function (sender, txid) {
    return new Promise((resolve, reject) => {
        btcOperator.getTx(txid).then(tx => {
            let vin_sender = tx.inputs.filter(v => floCrypto.isSameAddr(v.address, sender))
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            if (vin_sender.length !== tx.vin.length)
                return reject([true, "Transaction input containes other floIDs"]);
            if (!tx.block_no)
                return reject([false, "Transaction not included in any block yet"]);
            if (!tx.confirmations)
                return reject([false, "Transaction not confirmed yet"]);
            let amount = tx.outputs.reduce((a, v) =>
                blockchain.chests.includes(floCrypto.toFloID(v.address, { bech: [coinjs.bech32.version] })) ? a + parseFloat(v.value) : a, 0);
            if (amount == 0)
                return reject([true, "Transaction receiver is not market ID"]); //Maybe reject as false? (to compensate delay in chestsList loading from other nodes)
            else
                resolve(amount);
        }).catch(error => reject([false, error]))
    })
}

function verifyConvert() {
    DB.query("SELECT id, floID, mode, in_txid FROM DirectConvert WHERE status=? AND coin=?", ["PENDING", "BTC"]).then(results => {
        results.forEach(req => {
            if (mode == _sql.CONVERT_MODE_GET) {
                verifyTx.token(req.floID, req.in_txid, true).then(({ amount }) => {
                    conversion.getRate().then(rate => {
                        blockchain.convertToCoin.init(req.floID, "BTC", amount, amount / rate, req.id)
                    }).catch(error => console.error(error))
                }).catch(error => {
                    console.error(error);
                    if (error[0])
                        DB.query("UPDATE DirectConvert SET status=? WHERE id=?", ["REJECTED", req.id])
                            .then(_ => null).catch(error => console.error(error));
                });
            } else if (mode == _sql.CONVERT_MODE_PUT) {
                verifyTx.BTC(req.floID, req.in_txid).then(quantity => {
                    conversion.getRate().then(rate => {
                        blockchain.convertFromCoin.init(req.floID, quantity * rate, quantity, req.id)
                    }).catch(error => console.error(error))
                }).catch(error => {
                    console.error(error);
                    if (error[0])
                        DB.query("UPDATE DirectConvert SET status=? WHERE id=?", ["REJECTED", req.id])
                            .then(_ => null).catch(error => console.error(error));
                });
            }
        })
    }).catch(error => console.error(error))
}

function retryConvert() {
    DB.query("SELECT id, floID, mode, amount, quantity FROM DirectConvert WHERE status=? AND coin=?", ["PROCESSING", "BTC"]).then(results => {
        results.forEach(req => {
            if (mode == _sql.CONVERT_MODE_GET)
                blockchain.convertToCoin.retry(req.floID, "BTC", req.quantity, req.id);
            else if (mode == _sql.CONVERT_MODE_PUT)
                blockchain.convertFromCoin.retry(req.floID, req.amount, req.id)
        })
    }).catch(error => console.error(error))
}

function confirmConvert() {
    DB.query("SELECT id, floID, mode, amount, quantity, out_txid FROM DirectConvert WHERE status=? AND coin=?", ["WAITING_CONFIRMATION", "BTC"]).then(results => {
        results.forEach(req => {
            if (mode == _sql.CONVERT_MODE_GET)
                btcOperator.getTx(req.out_txid).then(tx => {
                    if (!tx.blockhash || !tx.confirmations) //Still not confirmed
                        return;
                    DB.query("UPDATE DirectConvert SET status=? WHERE id=?", ["SUCCESS", req.id])
                        .then(result => console.debug(`${req.floID} converted ${amount} to ${req.quantity} BTC`))
                        .catch(error => console.error(error))
                }).catch(error => console.error(error));
            else if (mode == _sql.CONVERT_MODE_PUT)
                floTokenAPI.getTx(req.out_txid).then(tx => {
                    DB.query("UPDATE DirectConvert SET status=? WHERE id=?", ["SUCCESS", req.id])
                        .then(result => console.debug(`${req.floID} converted ${req.quantity} BTC to ${amount}`))
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
    confirmWithdrawalToken,
    verifyConvert,
    retryConvert,
    confirmConvert,
    set updateBalance(f) {
        updateBalance = f;
    }
}