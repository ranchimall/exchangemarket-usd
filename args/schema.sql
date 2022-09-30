/* Blockchain Data */

CREATE TABLE LastTx(
    floID CHAR(34) NOT NULL,
    num INT,
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

CREATE TABLE InputCoin (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    coin VARCHAR(8) NOT NULL,
    amount DECIMAL(16, 8),
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id)
);

CREATE TABLE OutputCoin (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128),
    floID CHAR(34) NOT NULL,
    coin VARCHAR(8) NOT NULL,
    amount DECIMAL(16, 8) NOT NULL,
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id)
);

CREATE TABLE InputToken (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    token VARCHAR(64),
    amount DECIMAL(16, 8),
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id)
);

CREATE TABLE OutputToken (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128),
    floID CHAR(34) NOT NULL,
    token VARCHAR(64) NOT NULL,
    amount DECIMAL(16, 8) NOT NULL,
    status VARCHAR(50) NOT NULL,
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

/* Backup Feature (Tables & Triggers) */

CREATE TABLE _backup (
    t_name VARCHAR(64),
    id INT,
    mode BOOLEAN DEFAULT TRUE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(t_name, id)
);

CREATE table _backupCache(
    id INT AUTO_INCREMENT,
    t_name VARCHAR(64),
    data_cache LONGTEXT,
    status BOOLEAN,
    PRIMARY KEY(id)
);

CREATE TABLE sinkShares(
    floID CHAR(34) NOT NULL,
    share TEXT,
    time_stored TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(floID)
);

CREATE TRIGGER RequestLog_I AFTER INSERT ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER RequestLog_U AFTER UPDATE ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER RequestLog_D AFTER DELETE ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER UserSession_I AFTER INSERT ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserSession_U AFTER UPDATE ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserSession_D AFTER DELETE ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER UserBalance_I AFTER INSERT ON UserBalance
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserBalance', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserBalance_U AFTER UPDATE ON UserBalance
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserBalance', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserBalance_D AFTER DELETE ON UserBalance
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserBalance', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER SellChips_I AFTER INSERT ON SellChips
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellChips', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER SellChips_U AFTER UPDATE ON SellChips
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellChips', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER SellChips_D AFTER DELETE ON SellChips
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellChips', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER SellOrder_I AFTER INSERT ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER SellOrder_U AFTER UPDATE ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER SellOrder_D AFTER DELETE ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER BuyOrder_I AFTER INSERT ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER BuyOrder_U AFTER UPDATE ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER BuyOrder_D AFTER DELETE ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER InputCoin_I AFTER INSERT ON InputCoin
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputCoin', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputCoin_U AFTER UPDATE ON InputCoin
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputCoin', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputCoin_D AFTER DELETE ON InputCoin
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputCoin', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER OutputCoin_I AFTER INSERT ON OutputCoin
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputCoin', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputCoin_U AFTER UPDATE ON OutputCoin
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputCoin', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputCoin_D AFTER DELETE ON OutputCoin
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputCoin', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER InputToken_I AFTER INSERT ON InputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputToken_U AFTER UPDATE ON InputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputToken_D AFTER DELETE ON InputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputToken', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER OutputToken_I AFTER INSERT ON OutputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputToken_U AFTER UPDATE ON OutputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputToken_D AFTER DELETE ON OutputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputToken', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER UserTag_I AFTER INSERT ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserTag_U AFTER UPDATE ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserTag_D AFTER DELETE ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER Distributors_I AFTER INSERT ON Distributors
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Distributors', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Distributors_U AFTER UPDATE ON Distributors
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Distributors', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Distributors_D AFTER DELETE ON Distributors
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Distributors', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER PriceHistory_I AFTER INSERT ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER PriceHistory_U AFTER UPDATE ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER PriceHistory_D AFTER DELETE ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER AuditTrade_I AFTER INSERT ON AuditTrade
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTrade', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER AuditTrade_U AFTER UPDATE ON AuditTrade
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTrade', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER AuditTrade_D AFTER DELETE ON AuditTrade
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTrade', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER TradeTransactions_I AFTER INSERT ON TradeTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TradeTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER TradeTransactions_U AFTER UPDATE ON TradeTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TradeTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER TradeTransactions_D AFTER DELETE ON TradeTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TradeTransactions', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER TransferTransactions_I AFTER INSERT ON TransferTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransferTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER TransferTransactions_U AFTER UPDATE ON TransferTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransferTransactions', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER TransferTransactions_D AFTER DELETE ON TransferTransactions
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransferTransactions', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;