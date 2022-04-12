'use strict';

var DB; //container for database

function addTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO UserTag (floID, tag) VALUE (?,?)", [floID, tag])
            .then(result => resolve(`Added ${floID} to ${tag}`))
            .catch(error => {
                if (error.code === "ER_DUP_ENTRY")
                    reject(INVALID(`${floID} already in ${tag}`));
                else if (error.code === "ER_NO_REFERENCED_ROW")
                    reject(INVALID(`Invalid Tag`));
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

function addDistributor(floID, asset) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO Distributors (floID, asset) VALUE (?,?)", [floID, asset])
            .then(result => resolve(`Added ${asset} distributor: ${floID}`))
            .catch(error => {
                if (error.code === "ER_DUP_ENTRY")
                    reject(INVALID(`${floID} is already ${asset} disributor`));
                else if (error.code === "ER_NO_REFERENCED_ROW")
                    reject(INVALID(`Invalid Asset`));
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
    new Promise((resolve, reject) => {
        DB.query("SELECT id FROM Distributors WHERE floID=? AND asset=?", [floID, asset])
            .then(result => resolve(result.length ? true : false))
            .catch(error => reject(error))
    })
}

function getBestPairs(asset, cur_rate) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT tag, sellPriority, buyPriority FROM TagList").then(result => {
            //Sorted in Ascending (ie, stack; pop for highest)
            let tags_buy = result.sort((a, b) => a.buyPriority > b.buyPriority ? 1 : -1).map(r => r.tag);
            let tags_sell = result.sort((a, b) => a.sellPriority > b.sellPriority ? 1 : -1).map(r => r.tag);
            resolve(new bestPair(asset, cur_rate, tags_buy, tags_sell));
        }).catch(error => reject(error))
    })
}

const bestPair = function(asset, cur_rate, tags_buy, tags_sell) {

    Object.defineProperty(this, 'asset', {
        get: () => asset
    });

    Object.defineProperty(this, 'cur_rate', {
        get: () => cur_rate,
    });

    this.get = () => new Promise((resolve, reject) => {
        Promise.allSettled([getBuyOrder(), getSellOrder()]).then(results => {
            if (results[0].status === "fulfilled" && results[1].status === "fulfilled")
                resolve({
                    buyOrder: results[0].value,
                    sellOrder: results[1].value,
                    null_base: getSellOrder.cache.mode_null
                })
            else
                reject({
                    buy: results[0].reason,
                    sell: results[1].reason
                })
        }).catch(error => reject(error))
    });

    this.next = (tx_quantity, incomplete_sell) => {
        let buy = getBuyOrder.cache,
            sell = getSellOrder.cache;
        if (buy.cur_order && sell.cur_order) {
            //buy order
            if (tx_quantity < buy.cur_order.quantity)
                buy.cur_order.quantity -= tx_quantity;
            else if (tx_quantity == buy.cur_order.quantity)
                buy.cur_order = null;
            else
                throw Error("Tx quantity cannot be more than order quantity");
            //sell order
            if (tx_quantity < sell.cur_order.quantity) {
                sell.cur_order.quantity -= tx_quantity;
                if (incomplete_sell) {
                    if (!sell.mode_null)
                        sell.null_queue.push(sell.cur_order);
                    sell.cur_order = null;
                }
            } else if (tx_quantity == sell.cur_order.quantity)
                sell.cur_order = null;
            else
                throw Error("Tx quantity cannot be more than order quantity");
        } else
            throw Error("No current order found");
    };

    const getSellOrder = () => new Promise((resolve, reject) => {
        let cache = getSellOrder.cache;
        if (cache.cur_order) { //If cache already has a pending order
            verifySellOrder(cache.cur_order, asset, cur_rate, cache.mode_null).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //Order not valid (minimum gain)
                cache.cur_order = null;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.orders && cache.orders.length) { //If cache already has orders in priority
            getTopValidSellOrder(cache.orders, asset, cur_rate, cache.mode_null).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //No valid order found in current tag
                cache.orders = null;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.tags.length) { //If cache has remaining tags
            cache.cur_tag = cache.tags.pop();
            getSellOrdersInTag(cache.cur_tag, asset, cur_rate).then(orders => {
                cache.orders = orders;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else if (!cache.end) { //Un-tagged floID's orders  (do only once)
            getUntaggedSellOrders(asset, cur_rate).then(orders => {
                cache.orders = orders;
                cache.cur_tag = null;
                cache.end = true;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else if (!cache.mode_null) { //Lowest priority Assets (Brought from other sources)
            cache.orders = cache.null_queue.reverse(); //Reverse it so that we can pop the highest priority
            cache.mode_null = true;
            cache.null_queue = null;
            getSellOrder()
                .then(result => resolve(result))
                .catch(error => reject(error))
        } else
            reject(false);
    });
    getSellOrder.cache = {
        tags: tags_sell,
        null_queue: [],
        mode_null: false
    };

    const getBuyOrder = () => new Promise((resolve, reject) => {
        let cache = getBuyOrder.cache;
        if (cache.cur_order) { //If cache already has a pending order
            verifyBuyOrder(cache.cur_order, cur_rate).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //Order not valid (cash not available)
                cache.cur_order = null;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.orders && cache.orders.length) { //If cache already has orders in priority
            getTopValidBuyOrder(cache.orders, cur_rate).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //No valid order found in current tag
                cache.orders = null;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.tags.length) { //If cache has remaining tags
            cache.cur_tag = cache.tags.pop();
            getBuyOrdersInTag(cache.cur_tag, asset, cur_rate).then(orders => {
                cache.orders = orders;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else if (!cache.end) { //Un-tagged floID's orders  (do only once)
            getUntaggedBuyOrders(asset, cur_rate).then(orders => {
                cache.orders = orders;
                cache.cur_tag = null;
                cache.end = true;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else
            reject(false);
    });
    getBuyOrder.cache = {
        tags: tags_buy
    };
}

function getUntaggedSellOrders(asset, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
                " LEFT JOIN UserTag ON UserTag.floID = SellOrder.floID" +
                " WHERE UserTag.floID IS NULL AND SellOrder.asset = ? AND SellOrder.minPrice <=?" +
                " ORDER BY SellOrder.time_placed", [asset, cur_price])
            .then(orders => resolve(orders))
            .catch(error => reject(error))
    })
}

function getUntaggedBuyOrders(asset, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT BuyOrder.id, BuyOrder.floID, BuyOrder.quantity FROM BuyOrder" +
                " LEFT JOIN UserTag ON UserTag.floID = BuyOrder.floID" +
                " WHERE UserTag.floID IS NULL AND BuyOrder.asset = ? AND BuyOrder.maxPrice >=? " +
                " ORDER BY BuyOrder.time_placed", [asset, cur_price])
            .then(orders => resolve(orders))
            .catch(error => reject(error))
    })
}

function getSellOrdersInTag(tag, asset, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
            " INNER JOIN UserTag ON UserTag.floID = SellOrder.floID" +
            " WHERE UserTag.tag = ? AND SellOrder.asset = ? AND SellOrder.minPrice <=?" +
            " ORDER BY SellOrder.time_placed", [tag, asset, cur_price]).then(orders => {
            if (orders.length <= 1) // No (or) Only-one order, hence priority sort not required.
                resolve(orders);
            else
                getPointsFromAPI(tag, orders.map(o => o.floID)).then(points => {
                    let orders_sorted = orders.map(o => [o, points[o.floID]])
                        .sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0) //sort by points (ascending)
                        .map(x => x[0]);
                    resolve(orders_sorted);
                }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function getBuyOrdersInTag(tag, asset, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT BuyOrder.id, BuyOrder.floID, BuyOrder.quantity FROM BuyOrder" +
            " INNER JOIN UserTag ON UserTag.floID = BuyOrder.floID" +
            " WHERE UserTag.tag = ? AND BuyOrder.asset = ? AND BuyOrder.maxPrice >=?" +
            " ORDER BY BuyOrder.time_placed", [tag, asset, cur_price]).then(orders => {
            if (orders.length <= 1) // No (or) Only-one order, hence priority sort not required.
                resolve(orders);
            else
                getPointsFromAPI(tag, orders.map(o => o.floID)).then(points => {
                    let orders_sorted = orders.map(o => [o, points[o.floID]])
                        .sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0) //sort by points (ascending)
                        .map(x => x[0]);
                    resolve(orders_sorted);
                }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function getPointsFromAPI(tag, floIDs) {
    floIDs = Array.from(new Set(floIDs));
    return new Promise((resolve, reject) => {
        DB.query("SELECT api FROM TagList WHERE tag=?", [tag]).then(result => {
            let api = result[0].api;
            Promise.allSettled(floIDs.map(id => fetch_api(api, id))).then(result => {
                let points = {};
                for (let i in result)
                    points[floIDs[i]] = result[i].status === "fulfilled" ? result[i].value : 0;
                resolve(points);
            })
        }).catch(error => reject(error))
    });
}

function fetch_api(api, id) {
    return new Promise((resolve, reject) => {
        //TODO: fetch data from API
        let url = api.replace('<flo-id>', id);
        global.fetch(url).then(response => {
            if (response.ok)
                response.text()
                .then(result => resolve(result))
                .catch(error => reject(error))
            else
                reject(response);
        }).catch(error => reject(error))
    })
}

function getTopValidSellOrder(orders, asset, cur_price, mode_null) {
    return new Promise((resolve, reject) => {
        if (!orders.length)
            return reject(false)
        verifySellOrder(orders.pop(), asset, cur_price, mode_null) //pop: as the orders are sorted in ascending (highest point should be checked 1st)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                getTopValidSellOrder(orders, asset, cur_price, mode_null)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
    });
}

function verifySellOrder(sellOrder, asset, cur_price, mode_null) {
    return new Promise((resolve, reject) => {
        if (!mode_null)
            DB.query("SELECT quantity, base FROM Vault WHERE floID=? AND asset=? AND base IS NOT NULL ORDER BY base", [sellOrder.floID, asset]).then(result => {
                let rem = sellOrder.quantity,
                    sell_base = 0,
                    base_quantity = 0;
                for (let i = 0; i < result.length && rem > 0; i++) {
                    if (rem < result[i].quantity) {
                        sell_base += (rem * result[i].base);
                        base_quantity += rem;
                        rem = 0;
                    } else {
                        sell_base += (result[i].quantity * result[i].base);
                        base_quantity += result[i].quantity;
                        rem -= result[i].quantity;
                    }
                }
                if (base_quantity)
                    sell_base = sell_base / base_quantity;
                if (sell_base > cur_price)
                    reject(false);
                else
                    resolve(sellOrder);
            }).catch(error => reject(error));
        else if (mode_null)
            DB.query("SELECT IFNULL(SUM(quantity), 0) as total FROM Vault WHERE floID=? AND asset=?", [sellOrder.floID, asset]).then(result => {
                if (result[0].total < sellOrder.quantity)
                    console.warn(`Sell Order ${sellOrder.id} was made without enough Assets. This should not happen`);
                if (result[0].total > 0)
                    resolve(sellOrder);
                else
                    reject(false);
            }).catch(error => reject(error))
    })
}

function getTopValidBuyOrder(orders, cur_price) {
    return new Promise((resolve, reject) => {
        if (!orders.length)
            return reject(false)
        verifyBuyOrder(orders.pop(), cur_price) //pop: as the orders are sorted in ascending (highest point should be checked 1st)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                getTopValidBuyOrder(orders, cur_price)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
    });
}

function verifyBuyOrder(buyOrder, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT balance FROM Cash WHERE floID=?", [buyOrder.floID]).then(result => {
            if (!result.length || result[0].balance < cur_price * buyOrder.quantity) {
                //This should not happen unless a buy order is placed when user doesnt have enough cash balance
                console.warn(`Buy order ${buyOrder.id} is active, but Cash is insufficient`);
                reject(false);
            } else
                resolve(buyOrder);
        }).catch(error => reject(error));
    })
}

module.exports = {
    addTag,
    removeTag,
    addDistributor,
    removeDistributor,
    checkDistributor,
    getBestPairs,
    set DB(db) {
        DB = db;
    }
};