module.exports = {
    app: {
        BLOCKCHAIN_REFRESH_INTERVAL: 1 * 60 * 60 * 1000, //1 hr
    },
    request: {
        SIGN_EXPIRE_TIME: 5 * 60 * 1000, //5 mins
        MAX_SESSION_TIMEOUT: 30 * 24 * 60 * 60 * 1000, //30 days
    },
    market: {
        PERIOD_INTERVAL: 5 * 60 * 1000, //5 min,
        WAIT_TIME: 2 * 60 * 1000, //2 mins,
        LAUNCH_SELLER_TAG: "launch-seller",
        MAXIMUM_LAUNCH_SELL_CHIPS: 100000,
        TRADE_HASH_PREFIX: "z1",
        TRANSFER_HASH_PREFIX: "z0"
    },
    price: {
        MIN_TIME: 1 * 60 * 60 * 1000, // 1 hr
        DOWN_RATE: 0.05 / 100, //0.05% dec
        UP_RATE: 0.2 / 100, //0.2% inc
        MAX_DOWN_PER_DAY: 1 / 100, //max 1% dec
        MAX_UP_PER_DAY: 4 / 100, //max 4% inc
        CHECK_RATED_SELLER: false,
        TOP_RANGE: 10 / 100, //top 10%
        REC_HISTORY_INTERVAL: 1 * 60 * 60 * 1000, //1 hr
    },
    convert: {
        MIN_FUND: 0.3 // 30%
    },
    backup: {
        SHARE_THRESHOLD: 50 / 100, //50%
        HASH_N_ROW: 100,
        BACKUP_INTERVAL: 5 * 60 * 1000, //5 min
        BACKUP_SYNC_TIMEOUT: 10 * 60 * 1000, //10 mins
        CHECKSUM_INTERVAL: 100, //times of BACKUP_INTERVAL
    },
    sql: {
        CONVERT_MODE_GET: 1,
        CONVERT_MODE_PUT: 0,
    }
}