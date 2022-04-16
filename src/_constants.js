module.exports = {
    app: {
        BLOCKCHAIN_REFRESH_INTERVAL: 1 * 60 * 60 * 1000, // 1 hr
        PERIOD_INTERVAL: 15 * 60 * 1000 // 15 min
    },
    request: {
        SIGN_EXPIRE_TIME: 1 * 60 * 1000, //1 min
        MAX_SESSION_TIMEOUT: 30 * 24 * 60 * 60 * 1000, //30 days
        INVALID_SERVER_MSG: "INCORRECT_SERVER_ERROR" //Should be reflected in public backend script
    },
    market: {
        MAXIMUM_LAUNCH_SELL_CHIPS: 1000000,
        TRADE_HASH_PREFIX: "z1",
        TRANSFER_HASH_PREFIX: "z0"
    },
    price: {
        MIN_TIME: 1 * 60 * 60 * 1000, // 1 hr
        DOWN_RATE: 0.2 / 100, //0.2% dec
        UP_RATE: 0.5 / 100, //0.5 % inc
        MAX_DOWN_PER_DAY: 4.8 / 100, //max 4.8% dec
        MAX_UP_PER_DAY: 12 / 100, //max 12% inc
        TOP_RANGE: 10 / 100, //top 10%
        REC_HISTORY_INTERVAL: 1 * 60 * 60 * 1000, // 1 hr
    },
    backup: {
        SHARE_THRESHOLD: 50 / 100, // 50%
        HASH_N_ROW: 100,
        SINK_KEY_INDICATOR: '$$$',
        BACKUP_INTERVAL: 5 * 60 * 1000, //5 min
        BACKUP_SYNC_TIMEOUT: 10 * 60 * 1000, //10 mins
        CHECKSUM_INTERVAL: 100, //times of BACKUP_INTERVAL
    }
}