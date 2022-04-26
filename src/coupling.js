'use strict';

const price = require("./price");

const {
    TRADE_HASH_PREFIX
} = require("./_constants")["market"];

var DB; //container for database

const updateBalance = {};
updateBalance.consume = (floID, token, amount) => ["UPDATE UserBalance SET quantity=quantity-? WHERE floID=? AND token=?", [amount, floID, token]];
updateBalance.add = (floID, token, amount) => ["INSERT INTO UserBalance (floID, token, quantity) VALUE (?, ?, ?) ON DUPLICATE KEY UPDATE quantity=quantity+?", [floID, token, amount, amount]];

function startCouplingForAsset(asset) {
    price.getRates(asset).then(cur_rate => {
        cur_rate = cur_rate.toFixed(8);
        processCoupling(asset, cur_rate);
    }).catch(error => console.error(error));
}

function getBestPair(asset, cur_rate) {
    return new Promise((resolve, reject) => {
        Promise.allSettled([getBestBuyer(asset, cur_rate), getBestSeller(asset, cur_rate)]).then(results => {
            if (results[0].status === "fulfilled" && results[1].status === "fulfilled")
                resolve({
                    buy: results[0].value,
                    sell: results[1].value,
                })
            else
                reject({
                    buy: results[0].reason,
                    sell: results[1].reason
                })
        }).catch(error => reject(error))
    })
}

const getBestSeller = (asset, cur_rate) => new Promise((resolve, reject) => {
    DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity, SellChips.id AS chip_id, SellChips.quantity AS chip_quantity FROM SellOrder" +
        " INNER JOIN UserBalance ON UserBalance.floID = SellOrder.floID AND UserBalance.token = SellOrder.asset" +
        " INNER JOIN SellChips ON SellChips.floID = SellOrder.floID AND SellChips.asset = SellOrder.asset AND SellChips.base <= ?" +
        " LEFT JOIN UserTag ON UserTag.floID = SellOrder.floID" +
        " LEFT JOIN TagList ON TagList.tag = UserTag.tag" +
        " WHERE UserBalance.quantity >= SellOrder.quantity AND SellOrder.asset = ? AND SellOrder.minPrice <= ?" +
        " ORDER BY TagList.sellPriority DESC, SellChips.locktime ASC, SellOrder.time_placed ASC" +
        " LIMIT 1", [cur_rate, asset, cur_rate]
    ).then(result => {
        if (result.length)
            resolve(result[0]);
        else
            reject(null);
    }).catch(error => reject(error))
});

const getBestBuyer = (asset, cur_rate) => new Promise((resolve, reject) => {
    DB.query("SELECT BuyOrder.id, BuyOrder.floID, BuyOrder.quantity FROM BuyOrder" +
        " INNER JOIN UserBalance ON UserBalance.floID = BuyOrder.floID AND UserBalance.token = ?" +
        " LEFT JOIN UserTag ON UserTag.floID = BuyOrder.floID" +
        " LEFT JOIN TagList ON TagList.tag = UserTag.tag" +
        " WHERE UserBalance.quantity >= BuyOrder.maxPrice * BuyOrder.quantity AND BuyOrder.asset = ? AND BuyOrder.maxPrice >= ?" +
        " ORDER BY TagList.buyPriority DESC, BuyOrder.time_placed ASC" +
        " LIMIT 1", [floGlobals.currency, asset, cur_rate]
    ).then(result => {
        if (result.length)
            resolve(result[0]);
        else
            reject(null);
    }).catch(error => reject(error))
});

function processCoupling(asset, cur_rate) {
    getBestPair(asset, cur_rate).then(best => {
        //console.debug("Sell:", best.sell);
        //console.debug("Buy:", best.buy);
        let quantity = Math.min(best.buy.quantity, best.sell.quantity, best.sell.chip_quantity);
        let txQueries = processOrders(best.sell, best.buy, asset, cur_rate, quantity);
        //begin audit
        beginAudit(best.sell.floID, best.buy.floID, asset, cur_rate, quantity).then(audit => {
            //process txn query in SQL
            DB.transaction(txQueries).then(_ => {
                console.log(`Transaction was successful! BuyOrder:${best.buy.id}| SellOrder:${best.sell.id}`);
                audit.end();
                price.updateLastTime();
                //Since a tx was successful, match again
                processCoupling(asset, cur_rate);
            }).catch(error => console.error(error));
        }).catch(error => console.error(error));
    }).catch(error => {
        let noBuy, noSell;
        if (error.buy === undefined)
            noBuy = false;
        else if (error.buy !== null) {
            console.error(error.buy);
            noBuy = null;
        } else {
            console.log("No valid buyOrders for Asset:", asset);
            noBuy = true;
        }
        if (error.sell === undefined)
            noSell = false;
        else if (error.sell !== null) {
            console.error(error.sell);
            noSell = null;
        } else {
            console.log("No valid sellOrders for Asset:", asset);
            noSell = true;
        }
        price.noOrder(asset, noBuy, noSell);
    });
}

function processOrders(seller_best, buyer_best, asset, cur_rate, quantity) {
    let txQueries = [];
    if (quantity > buyer_best.quantity || quantity > seller_best.quantity)
        throw Error("Tx quantity cannot be more than order quantity");

    //Process Buy Order
    if (quantity == buyer_best.quantity)
        txQueries.push(["DELETE FROM BuyOrder WHERE id=?", [buyer_best.id]]);
    else
        txQueries.push(["UPDATE BuyOrder SET quantity=quantity-? WHERE id=?", [quantity, buyer_best.id]]);

    //Process Sell Order
    if (quantity == seller_best.quantity)
        txQueries.push(["DELETE FROM SellOrder WHERE id=?", [seller_best.id]]);
    else
        txQueries.push(["UPDATE SellOrder SET quantity=quantity-? WHERE id=?", [quantity, seller_best.id]]);

    //Process Sell Chip
    if (quantity == seller_best.chip_quantity)
        txQueries.push(["DELETE FROM SellChips WHERE id=?", [seller_best.chip_id]]);
    else
        txQueries.push(["UPDATE SellChips SET quantity=quantity-? WHERE id=?", [quantity, seller_best.chip_id]]);

    //Update cash/asset balance for seller and buyer
    let totalAmount = cur_rate * quantity;
    txQueries.push(updateBalance.add(seller_best.floID, floGlobals.currency, totalAmount));
    txQueries.push(updateBalance.consume(buyer_best.floID, floGlobals.currency, totalAmount));
    txQueries.push(updateBalance.consume(seller_best.floID, asset, quantity));
    txQueries.push(updateBalance.add(buyer_best.floID, asset, quantity));

    //Add SellChips to Buyer
    txQueries.push(["INSERT INTO SellChips(floID, asset, base, quantity) VALUES (?, ?, ?, ?)", [buyer_best.floID, asset, cur_rate, quantity]])

    //Record transaction
    let time = Date.now();
    let hash = TRADE_HASH_PREFIX + Crypto.SHA256(JSON.stringify({
        seller: seller_best.floID,
        buyer: buyer_best.floID,
        asset: asset,
        quantity: quantity,
        unitValue: cur_rate,
        tx_time: time,
    }));
    txQueries.push([
        "INSERT INTO TradeTransactions (seller, buyer, asset, quantity, unitValue, tx_time, txid) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [seller_best.floID, buyer_best.floID, asset, quantity, cur_rate, global.convertDateToString(time), hash]
    ]);

    return txQueries;
}

function beginAudit(sellerID, buyerID, asset, unit_price, quantity) {
    return new Promise((resolve, reject) => {
        auditBalance(sellerID, buyerID, asset).then(old_bal => resolve({
            end: () => endAudit(sellerID, buyerID, asset, old_bal, unit_price, quantity)
        })).catch(error => reject(error))
    })
}

function endAudit(sellerID, buyerID, asset, old_bal, unit_price, quantity) {
    auditBalance(sellerID, buyerID, asset).then(new_bal => {
        DB.query("INSERT INTO AuditTrade (asset, quantity, unit_price, total_cost," +
            " sellerID, seller_old_cash, seller_old_asset, seller_new_cash, seller_new_asset," +
            " buyerID, buyer_old_cash, buyer_old_asset, buyer_new_cash, buyer_new_asset)" +
            " Value (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                asset, quantity, unit_price, quantity * unit_price,
                sellerID, old_bal[sellerID].cash, old_bal[sellerID].asset, new_bal[sellerID].cash, new_bal[sellerID].asset,
                buyerID, old_bal[buyerID].cash, old_bal[buyerID].asset, new_bal[buyerID].cash, new_bal[buyerID].asset,
            ]).then(_ => null).catch(error => console.error(error))
    }).catch(error => console.error(error));
}

function auditBalance(sellerID, buyerID, asset) {
    return new Promise((resolve, reject) => {
        let balance = {
            [sellerID]: {
                cash: 0,
                asset: 0
            },
            [buyerID]: {
                cash: 0,
                asset: 0
            }
        };
        DB.query("SELECT floID, quantity, token FROM UserBalance WHERE floID IN (?, ?) AND token IN (?, ?)", [sellerID, buyerID, floGlobals.currency, asset]).then(result => {
            for (let i in result) {
                if (result[i].token === floGlobals.currency)
                    balance[result[i].floID].cash = result[i].quantity;
                else if (result[i].token === asset)
                    balance[result[i].floID].asset = result[i].quantity;
            }
            resolve(balance);
        }).catch(error => reject(error))
    })
}

module.exports = {
    initiate: startCouplingForAsset,
    updateBalance,
    price,
    set DB(db) {
        DB = db;
        price.DB = db;
    }
}