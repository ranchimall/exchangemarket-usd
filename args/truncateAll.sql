/* Node data */
TRUNCATE _backup;
TRUNCATE _backupCache;
TRUNCATE AuditTrade;
TRUNCATE BuyOrder;
TRUNCATE Distributors;
TRUNCATE VaultTransactions;
TRUNCATE PriceHistory;
TRUNCATE RequestLog;
TRUNCATE SellOrder;
TRUNCATE UserBalance;
TRUNCATE UserSession;
TRUNCATE UserTag;
TRUNCATE TransferTransactions;
TRUNCATE TradeTransactions;
TRUNCATE SellChips;
TRUNCATE CloseBondTransact;
TRUNCATE CloseFundTransact;
TRUNCATE ConvertFund;
TRUNCATE DirectConvert;
TRUNCATE RefundConvert;

/* Blockchain data */
TRUNCATE LastTx;
TRUNCATE NodeList;
TRUNCATE TrustedList;
DELETE FROM BlockchainBonds;
TRUNCATE BobsFundInvestments;
DELETE FROM BobsFund;
DELETE FROM TagList;
DELETE FROM AssetList;