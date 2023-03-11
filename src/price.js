'use strict';
const DB = require("./database");

const {
    MIN_TIME,
    DOWN_RATE,
    UP_RATE,
    MAX_DOWN_PER_DAY,
    MAX_UP_PER_DAY,
    CHECK_RATED_SELLER,
    TOP_RANGE,
    REC_HISTORY_INTERVAL
} = require("./_constants")["price"];

var currentRate = {}, //container for FLO price (from API or by model)
    lastTime = {}, //container for timestamp of the last tx
    noBuyOrder = {},
    noSellOrder = {};

const updateLastTime = asset => lastTime[asset] = Date.now();

//store FLO price in database every 1 hr
function storeHistory(asset, rate) {
    DB.query("INSERT INTO PriceHistory (asset, rate) VALUE (?)", [[asset, global.toStandardDecimal(rate)]])
        .then(_ => null).catch(error => console.error(error))
}

storeHistory.start = function () {
    storeHistory.stop();
    storeHistory.instance = setInterval(() => {
        for (let asset in currentRate)
            storeHistory(asset, currentRate[asset]);
    }, REC_HISTORY_INTERVAL);
}

storeHistory.stop = function () {
    if (storeHistory.instance !== undefined) {
        clearInterval(storeHistory.instance);
        delete storeHistory.instance;
    }
}

function getPastRate(asset, hrs = 24) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT rate FROM PriceHistory WHERE asset=? AND rec_time >= NOW() - INTERVAL ? hour ORDER BY rec_time LIMIT 1", [asset, hrs])
            .then(result => result.length ? resolve(result[0].rate) : reject('No records found in past 24hrs'))
            .catch(error => reject(error))
    });
}

function getHistory(asset, duration = '') {
    return new Promise((resolve, reject) => {
        let { statement, values } = getHistory.getRateStatement(asset, duration);
        DB.query(statement, values)
            .then(result => resolve(result))
            .catch(error => reject(error))
    });
}

getHistory.statement = {
    'all-time': "SELECT DATE(rec_time) AS time, AVG(rate) as rate FROM PriceHistory WHERE asset=? GROUP BY time ORDER BY time",
    'year': "SELECT DATE(rec_time) AS time, AVG(rate) as rate FROM PriceHistory WHERE asset=? AND rec_time >= NOW() - INTERVAL ? year GROUP BY time ORDER BY time",
    'month': "SELECT DATE(rec_time) AS time, AVG(rate) as rate FROM PriceHistory WHERE asset=? AND rec_time >= NOW() - INTERVAL ? month GROUP BY time ORDER BY time",
    'week': "SELECT rec_time AS time, rate FROM PriceHistory WHERE asset=? AND rec_time >= NOW() - INTERVAL ? week ORDER BY time",
    'day': "SELECT rec_time AS time, rate FROM PriceHistory WHERE asset=? AND rec_time >= NOW() - INTERVAL ? day ORDER BY time"
}

getHistory.getRateStatement = (asset, duration) => {
    let n = duration.match(/\d+/g),
        d = duration.match(/\D+/g);
    n = n ? n[0] || 1 : 1;
    d = d ? d[0].replace(/[-\s]/g, '') : "";

    switch (d.toLowerCase()) {
        case "day":
        case "days":
            return { statement: getHistory.statement['day'], values: [asset, n] };
        case "week":
        case "weeks":
            return { statement: getHistory.statement['week'], values: [asset, n] };
        case "month":
        case "months":
            return { statement: getHistory.statement['month'], values: [asset, n] };
        case "year":
        case "years":
            return { statement: getHistory.statement['year'], values: [asset, n] };
        case "alltime":
            return { statement: getHistory.statement['all-time'], values: [asset] };
        default:
            return { statement: getHistory.statement['day'], values: [asset, 1] };
    }
}

function loadRate(asset) {
    return new Promise((resolve, reject) => {
        if (typeof currentRate[asset] !== "undefined")
            return resolve(currentRate[asset]);
        DB.query("SELECT rate FROM PriceHistory WHERE asset=? ORDER BY rec_time DESC LIMIT 1", [asset]).then(result => {
            updateLastTime(asset);
            if (result.length)
                resolve(currentRate[asset] = result[0].rate);
            else
                DB.query("SELECT initialPrice FROM AssetList WHERE asset=?", [asset]).then(result => {
                    currentRate[asset] = result[0].initialPrice;
                    storeHistory(asset, currentRate[asset]);
                    resolve(currentRate[asset]);
                }).catch(error => reject(error))
        }).catch(error => reject(error));
    })
}

function getRates(asset, updatePrice = false) {
    return new Promise((resolve, reject) => {
        loadRate(asset).then(_ => {
            //console.debug(asset, currentRate[asset]);
            let cur_time = Date.now();
            if (!updatePrice || cur_time - lastTime[asset] < MIN_TIME) //Minimum time to update not crossed: No update required
                resolve(currentRate[asset]);
            else if (noBuyOrder[asset] && noSellOrder[asset]) //Both are not available: No update required
                resolve(currentRate[asset]);
            else if (noBuyOrder[asset] === null || noSellOrder[asset] === null) //An error has occured during last process: No update (might cause price to crash/jump)
                resolve(currentRate[asset]);
            else
                getPastRate(asset).then(ratePast24hr => {
                    if (noBuyOrder[asset]) {
                        //No Buy, But Sell available: Decrease the price
                        let tmp_val = currentRate[asset] * (1 - DOWN_RATE);
                        if (tmp_val >= ratePast24hr * (1 - MAX_DOWN_PER_DAY))
                            currentRate[asset] = tmp_val;
                        else
                            console.debug("Max Price down for the day has reached");
                        resolve(currentRate[asset]);
                    } else if (noSellOrder[asset]) {
                        //No Sell, But Buy available: Increase the price
                        checkForRatedSellers(asset).then(result => {
                            if (result) {
                                let tmp_val = currentRate[asset] * (1 + UP_RATE);
                                if (tmp_val <= ratePast24hr * (1 + MAX_UP_PER_DAY))
                                    currentRate[asset] = tmp_val;
                                else
                                    console.debug("Max Price up for the day has reached");
                            }
                        }).catch(error => console.error(error)).finally(_ => resolve(currentRate[asset]));
                    }
                }).catch(error => {
                    console.error(error);
                    resolve(currentRate[asset]);
                });
        }).catch(error => reject(error));
    })
}

function checkForRatedSellers(asset) {
    //Check if there are best rated sellers?
    return new Promise((resolve, reject) => {
        if (!CHECK_RATED_SELLER) //switch for the check case
            return resolve(true);
        DB.query("SELECT MAX(sellPriority) as max_p FROM TagList").then(result => {
            let ratedMin = result[0].max_p * (1 - TOP_RANGE);
            DB.query("SELECT COUNT(*) as value FROM SellOrder WHERE floID IN (" +
                " SELECT UserTag.floID FROM UserTag INNER JOIN TagList ON UserTag.tag = TagList.tag" +
                " WHERE TagList.sellPriority > ?) AND asset=?", [ratedMin, asset]).then(result => {
                    resolve(result[0].value > 0);
                }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    getRates,
    getHistory,
    storeHistory,
    updateLastTime,
    MIN_TIME,
    noOrder(asset, buy, sell) {
        noBuyOrder[asset] = buy;
        noSellOrder[asset] = sell;
    },
    get currentRates() {
        return Object.assign({}, currentRate);
    },
    get lastTimes() {
        let countDown = {};
        for (let asset in lastTime)
            countDown[asset] = lastTime[asset] + MIN_TIME;
        return countDown;
    }
}