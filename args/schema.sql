/* Blockchain Data */

CREATE TABLE LastTx(
    floID CHAR(34) NOT NULL,
    txid VARCHAR(128),
    PRIMARY KEY(floID)
);

CREATE TABLE NodeList(
    floID CHAR(34) NOT NULL, 
    uri TINYTEXT,
    PRIMARY KEY(floID)
);

CREATE TABLE TagList (
    tag VARCHAR(50) NOT NULL,
    sellPriority INT,
    buyPriority INT,
    PRIMARY KEY(tag)
);

CREATE TABLE AssetList (
    asset VARCHAR(64) NOT NULL,
    initialPrice DECIMAL(16, 8),
    PRIMARY KEY(asset)
);

CREATE TABLE TrustedList(
    floID CHAR(34) NOT NULL,
    PRIMARY KEY(floID)
);

/* User Data */

CREATE TABLE UserSession (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    proxyKey CHAR(66) NOT NULL,
    session_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY (id),
    PRIMARY KEY(floID)
);

CREATE TABLE UserBalance (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    token VARCHAR(64) NOT NULL,
    quantity DECIMAL(16, 8) NOT NULL DEFAULT 0,
    PRIMARY KEY(floID, token),
    KEY(id)
);

CREATE TABLE SellChips (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    locktime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    asset VARCHAR(64) NOT NULL,
    base DECIMAL(16, 8) NOT NULL DEFAULT 0,
    quantity DECIMAL(16, 8) NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE UserTag (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    tag VARCHAR(50) NOT NULL,
    PRIMARY KEY(floID, tag),
    KEY (id),
    FOREIGN KEY (tag) REFERENCES TagList(tag)
);

CREATE TABLE Distributors(
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    KEY(id),
    PRIMARY KEY(floID, asset),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

/* User Requests */

CREATE TABLE RequestLog(
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    request TEXT NOT NULL,
    sign VARCHAR(160) NOT NULL,
    proxy BOOLEAN NOT NULL,
    request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    UNIQUE (sign)
);

CREATE TABLE SellOrder (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    quantity DECIMAL(16, 8) NOT NULL,
    minPrice DECIMAL(16, 8) NOT NULL,
    time_placed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE BuyOrder (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    quantity DECIMAL(16, 8) NOT NULL,
    maxPrice DECIMAL(16, 8) NOT NULL,
    time_placed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE VaultTransactions (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    mode TINYINT NOT NULL,
    asset_type TINYINT NOT NULL,
    asset VARCHAR(32),
    amount DECIMAL(16, 8),
    txid VARCHAR(128),
    locktime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    r_status TINYINT NOT NULL,
    PRIMARY KEY(id)
);

/* Transaction Data */

CREATE TABLE PriceHistory (
    id INT NOT NULL AUTO_INCREMENT,
    asset VARCHAR(64) NOT NULL,
    rate DECIMAL(16, 8) NOT NULL,
    rec_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE TransferTransactions (
    id INT NOT NULL AUTO_INCREMENT,
    sender CHAR(34) NOT NULL,
    receiver TEXT NOT NULL,
    token VARCHAR(64) NOT NULL,
    totalAmount DECIMAL(16, 8) NOT NULL,
    tx_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    txid VARCHAR(66) NOT NULL,
    KEY(id),
    PRIMARY KEY(txid)
);

CREATE TABLE TradeTransactions (
    id INT NOT NULL AUTO_INCREMENT,
    seller CHAR(34) NOT NULL,
    buyer CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    quantity DECIMAL(16, 8) NOT NULL,
    unitValue DECIMAL(16, 8) NOT NULL,
    tx_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    txid VARCHAR(66) NOT NULL,
    KEY(id),
    PRIMARY KEY(txid),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE AuditTrade(
    id INT NOT NULL AUTO_INCREMENT,
    rec_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unit_price DECIMAL(16, 8) NOT NULL,
    quantity DECIMAL(16, 8) NOT NULL,
    total_cost DECIMAL(16, 8) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    sellerID CHAR(34) NOT NULL,
    seller_old_asset DECIMAL(16, 8) NOT NULL,
    seller_new_asset DECIMAL(16, 8) NOT NULL,
    seller_old_cash DECIMAL(16, 8) NOT NULL,
    seller_new_cash DECIMAL(16, 8) NOT NULL,
    buyerID CHAR(34) NOT NULL,
    buyer_old_asset DECIMAL(16, 8) NOT NULL,
    buyer_new_asset DECIMAL(16, 8) NOT NULL,
    buyer_old_cash DECIMAL(16, 8) NOT NULL,
    buyer_new_cash DECIMAL(16, 8) NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

/* External Service */

CREATE TABLE BlockchainBonds(
    bond_id VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    amount_in DECIMAL(16, 2) NOT NULL,
    begin_date DATE NOT NULL,
    btc_base DECIMAL(16, 2) NOT NULL,
    usd_base DECIMAL(16, 2) NOT NULL,
    gain_cut DECIMAL(6, 5) NOT NULL,
    min_ipa DECIMAL(6, 5) NOT NULL,
    max_period VARCHAR(10) NOT NULL,
    lockin_period VARCHAR(10) NOT NULL,
    close_id VARCHAR(128),
    amount_out DECIMAL(16, 2),
    PRIMARY KEY(bond_id)
);

CREATE TABLE CloseBondTransact(
    id INT NOT NULL AUTO_INCREMENT,
    bond_id VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    amount DECIMAL(16, 2) NOT NULL,
    end_date DATE NOT NULL,
    ref_sign VARCHAR(180) NOT NULL,
    btc_net DECIMAL(16, 2) NOT NULL,
    usd_net DECIMAL(16, 2) NOT NULL,
    txid VARCHAR(128),
    close_id VARCHAR(128),
    r_status TINYINT NOT NULL,
    KEY(id),
    PRIMARY KEY(bond_id),
    FOREIGN KEY (bond_id) REFERENCES BlockchainBonds(bond_id)
);

CREATE TABLE BobsFund(
    fund_id VARCHAR(128) NOT NULL,
    begin_date DATE NOT NULL,
    btc_base DECIMAL(16, 2) NOT NULL,
    usd_base DECIMAL(16, 2) NOT NULL,
    fee DECIMAL(6, 5) NOT NULL,
    duration VARCHAR(10) NOT NULL,
    tapout_window VARCHAR(10),
    tapout_interval VARCHAR(40),
    PRIMARY KEY(fund_id)
);

CREATE TABLE BobsFundInvestments(
    fund_id VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    amount_in DECIMAL(16, 2) NOT NULL,
    close_id VARCHAR(128),
    amount_out DECIMAL(16, 2),
    PRIMARY KEY(fund_id, floID),
    FOREIGN KEY (fund_id) REFERENCES BobsFund(fund_id)
);

CREATE TABLE CloseFundTransact(
    id INT NOT NULL AUTO_INCREMENT,
    fund_id VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    amount DECIMAL(16, 2) NOT NULL,
    end_date DATE NOT NULL,
    ref_sign VARCHAR(180) NOT NULL,
    btc_net DECIMAL(16, 2) NOT NULL,
    usd_net DECIMAL(16, 2) NOT NULL,
    txid VARCHAR(128),
    close_id VARCHAR(128),
    r_status TINYINT NOT NULL,
    KEY(id),
    PRIMARY KEY(fund_id, floID),
    FOREIGN KEY (fund_id) REFERENCES BobsFund(fund_id)
);

CREATE TABLE ConvertFund(
    id INT NOT NULL AUTO_INCREMENT, 
    amount DECIMAL(16, 8),
    coin VARCHAR(8) NOT NULL,
    quantity DECIMAL(16, 8),
    mode TINYINT NOT NULL,
    txid VARCHAR(128),
    r_status TINYINT NOT NULL,
    PRIMARY KEY(id)
);

CREATE TABLE DirectConvert(
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    amount DECIMAL(16, 8),
    coin VARCHAR(8) NOT NULL,
    quantity DECIMAL(16, 8),
    mode TINYINT NOT NULL,
    rate DECIMAL(16, 2),
    in_txid VARCHAR(128),
    out_txid VARCHAR(128),
    locktime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    r_status TINYINT NOT NULL,
    PRIMARY KEY(id)
);

CREATE TABLE RefundConvert(
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    asset_type TINYINT NOT NULL,
    asset VARCHAR(32) NOT NULL,
    amount DECIMAL(16, 8),
    in_txid VARCHAR(128),
    out_txid VARCHAR(128),
    locktime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    r_status TINYINT NOT NULL,
    PRIMARY KEY(id)
);

/* Backup Feature (Tables & Triggers) */

CREATE TABLE _backup (
    t_name VARCHAR(64),
    id INT,
    mode BOOLEAN DEFAULT TRUE,
    u_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(t_name, id)
);

CREATE table _backupCache(
    id INT AUTO_INCREMENT,
    t_name VARCHAR(64),
    data_cache LONGTEXT,
    fail BOOLEAN,
    PRIMARY KEY(id)
);

CREATE TABLE sinkShares(
    num INT UNSIGNED NOT NULL AUTO_INCREMENT,
    share TEXT,
    time_stored TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(num)
);

CREATE TABLE discardedSinks(
    id INT AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    discard_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY(id),
    PRIMARY KEY(floID)
);

CREATE TRIGGER discardedSinks_I AFTER INSERT ON discardedSinks
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('discardedSinks', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER discardedSinks_U AFTER UPDATE ON discardedSinks
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('discardedSinks', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER discardedSinks_D AFTER DELETE ON discardedSinks
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('discardedSinks', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER RequestLog_I AFTER INSERT ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER RequestLog_U AFTER UPDATE ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER RequestLog_D AFTER DELETE ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER UserSession_I AFTER INSERT ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER UserSession_U AFTER UPDATE ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER UserSession_D AFTER DELETE ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER UserBalance_I AFTER INSERT ON UserBalance
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserBalance', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER UserBalance_U AFTER UPDATE ON UserBalance
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserBalance', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER UserBalance_D AFTER DELETE ON UserBalance
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserBalance', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER SellChips_I AFTER INSERT ON SellChips
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellChips', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER SellChips_U AFTER UPDATE ON SellChips
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellChips', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER SellChips_D AFTER DELETE ON SellChips
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellChips', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER SellOrder_I AFTER INSERT ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER SellOrder_U AFTER UPDATE ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER SellOrder_D AFTER DELETE ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER BuyOrder_I AFTER INSERT ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER BuyOrder_U AFTER UPDATE ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER BuyOrder_D AFTER DELETE ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER VaultTransactions_I AFTER INSERT ON VaultTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('VaultTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER VaultTransactions_U AFTER UPDATE ON VaultTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('VaultTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER VaultTransactions_D AFTER DELETE ON VaultTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('VaultTransactions', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER CloseBondTransact_I AFTER INSERT ON CloseBondTransact
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('CloseBondTransact', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER CloseBondTransact_U AFTER UPDATE ON CloseBondTransact
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('CloseBondTransact', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER CloseBondTransact_D AFTER DELETE ON CloseBondTransact
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('CloseBondTransact', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER CloseFundTransact_I AFTER INSERT ON CloseFundTransact
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('CloseFundTransact', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER CloseFundTransact_U AFTER UPDATE ON CloseFundTransact
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('CloseFundTransact', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER CloseFundTransact_D AFTER DELETE ON CloseFundTransact
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('CloseFundTransact', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER ConvertFund_I AFTER INSERT ON ConvertFund
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('ConvertFund', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER ConvertFund_U AFTER UPDATE ON ConvertFund
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('ConvertFund', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER ConvertFund_D AFTER DELETE ON ConvertFund
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('ConvertFund', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER DirectConvert_I AFTER INSERT ON DirectConvert
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('DirectConvert', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER DirectConvert_U AFTER UPDATE ON DirectConvert
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('DirectConvert', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER DirectConvert_D AFTER DELETE ON DirectConvert
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('DirectConvert', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER RefundConvert_I AFTER INSERT ON RefundConvert
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RefundConvert', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER RefundConvert_U AFTER UPDATE ON RefundConvert
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RefundConvert', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER RefundConvert_D AFTER DELETE ON RefundConvert
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RefundConvert', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER UserTag_I AFTER INSERT ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER UserTag_U AFTER UPDATE ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER UserTag_D AFTER DELETE ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER Distributors_I AFTER INSERT ON Distributors
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Distributors', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER Distributors_U AFTER UPDATE ON Distributors
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Distributors', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER Distributors_D AFTER DELETE ON Distributors
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Distributors', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER PriceHistory_I AFTER INSERT ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER PriceHistory_U AFTER UPDATE ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER PriceHistory_D AFTER DELETE ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER AuditTrade_I AFTER INSERT ON AuditTrade
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTrade', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER AuditTrade_U AFTER UPDATE ON AuditTrade
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTrade', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER AuditTrade_D AFTER DELETE ON AuditTrade
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTrade', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER TradeTransactions_I AFTER INSERT ON TradeTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TradeTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER TradeTransactions_U AFTER UPDATE ON TradeTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TradeTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER TradeTransactions_D AFTER DELETE ON TradeTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TradeTransactions', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;

CREATE TRIGGER TransferTransactions_I AFTER INSERT ON TransferTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransferTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER TransferTransactions_U AFTER UPDATE ON TransferTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransferTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, u_time=DEFAULT;
CREATE TRIGGER TransferTransactions_D AFTER DELETE ON TransferTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransferTransactions', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, u_time=DEFAULT;