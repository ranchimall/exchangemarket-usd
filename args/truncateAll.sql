/* Node data */
TRUNCATE _backup;
TRUNCATE _backupCache;
TRUNCATE AuditTrade;
TRUNCATE BuyOrder;
TRUNCATE Distributors;
TRUNCATE InputFLO;
TRUNCATE InputToken;
TRUNCATE OutputFLO;
TRUNCATE OutputToken;
TRUNCATE PriceHistory;
TRUNCATE RequestLog;
TRUNCATE SellOrder;
TRUNCATE UserBalance;
TRUNCATE UserSession;
TRUNCATE UserTag;
TRUNCATE TransferTransactions;
TRUNCATE TradeTransactions;
TRUNCATE SellChips;

/* Blockchain data */
TRUNCATE LastTx;
TRUNCATE NodeList;
TRUNCATE TrustedList;
DELETE FROM TagList;
DELETE FROM AssetList;