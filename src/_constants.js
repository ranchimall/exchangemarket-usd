module.exports = {
    app: {
        BLOCKCHAIN_REFRESH_INTERVAL: 1 * 60 * 60 * 1000, //1 hr
    },
    request: {
        SIGN_EXPIRE_TIME: 5 * 60 * 1000, //5 mins
        MAX_SESSION_TIMEOUT: 30 * 24 * 60 * 60 * 1000, //30 days
    },
    background: {
        PERIOD_INTERVAL: 5 * 60 * 1000, //5 min,
        WAIT_TIME: 2 * 60 * 1000, //2 mins,
        REQUEST_TIMEOUT: 24 * 60 * 60 * 1000, //1 day
    },
    keys: {
        SHARES_PER_NODE: 8,
        SHARE_THRESHOLD: 50 / 100, //50%
        DISCARD_COOLDOWN: 24 * 60 * 60 * 1000, //1 day
        SHUFFLE_INTERVAL: 12 * 60 * 60 * 1000, //12 hrs
    },
    market: {
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
        MIN_FUND: 0.3, // 30%
        TO_FIXED_VALUES: [250, 500],
        TO_MIN_VALUE: 1000,
        TO_MAX_VALUE: 10000,
        FROM_FIXED_VALUES: [0.01],
        FROM_MIN_VALUE: 0.0001,
        FROM_MAX_VALUE: 10000,
    },
    backup: {
        HASH_N_ROW: 100,
        BACKUP_INTERVAL: 5 * 60 * 1000, //5 min
        BACKUP_SYNC_TIMEOUT: 10 * 60 * 1000, //10 mins
        CHECKSUM_INTERVAL: 10, //times of BACKUP_INTERVAL
    }
}