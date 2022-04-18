'use strict';

const K_Bucket = require('../../docs/scripts/floExchangeAPI').K_Bucket;
const slave = require('./slave');
const sync = require('./sync');
const WebSocket = require('ws');

const {
    SINK_KEY_INDICATOR,
    SHARE_THRESHOLD
} = require("../_constants")["backup"];

var DB, app, wss, tokenList; //Container for database and app
var nodeList, nodeURL, nodeKBucket; //Container for (backup) node list
var nodeShares = null,
    connectedSlaves = {},
    mod = null;
const SLAVE_MODE = 0,
    MASTER_MODE = 1;

//Shares
function generateShares(sinkKey) {
    let nextNodes = nodeKBucket.nextNode(global.myFloID, null),
        aliveNodes = Object.keys(connectedSlaves);
    if (nextNodes.length == 0) //This is the last node in nodeList
        return false;
    else if (aliveNodes.length == 0) //This is the last node in nodeList
        return null;
    else {
        let N = nextNodes.length + 1,
            th = Math.ceil(aliveNodes.length * SHARE_THRESHOLD) + 1,
            shares, refShare, mappedShares = {};
        shares = floCrypto.createShamirsSecretShares(sinkKey, N, th);
        refShare = shares.pop();
        for (let i in nextNodes)
            mappedShares[nextNodes[i]] = [refShare, shares[i]].join("|");
        return mappedShares;
    }
}

function sendShare(ws, sinkID, keyShare) {
    ws.send(JSON.stringify({
        command: "SINK_SHARE",
        sinkID,
        keyShare: floCrypto.encryptData(keyShare, ws.pubKey)
    }));
}

function sendSharesToNodes(sinkID, shares) {
    nodeShares = shares;
    for (let node in shares)
        if (node in connectedSlaves)
            sendShare(connectedSlaves[node], sinkID, shares[node]);
}

function storeSink(sinkID, sinkPrivKey) {
    global.sinkID = sinkID;
    global.sinkPrivKey = sinkPrivKey;
    let encryptedKey = Crypto.AES.encrypt(SINK_KEY_INDICATOR + sinkPrivKey, global.myPrivKey);
    DB.query('INSERT INTO sinkShares (floID, share) VALUE (?, ?) ON DUPLICATE KEY UPDATE share=?', [sinkID, encryptedKey, encryptedKey])
        .then(_ => console.log('SinkID:', sinkID, '|SinkEnKey:', encryptedKey))
        .catch(error => console.error(error));
}

/*
function transferMoneyToNewSink(oldSinkID, oldSinkKey, newSink) {
    const transferToken = token => new Promise((resolve, reject) => {
        floTokenAPI.getBalance(oldSinkID, token).then(tokenBalance => {
            floBlockchainAPI.writeData(oldSinkID, `send ${tokenBalance} ${token}# |Exchange-market New sink`, oldSinkKey, newSink.floID, false)
                .then(txid => resolve(txid))
                .catch(error => reject(error))
        })
    });
    return new Promise((resolve, reject) => {
        console.debug("Transferring tokens to new Sink:", newSink.floID)
        Promise.allSettled(tokenList.map(token => transferToken(token))).then(result => {
            let failedFlag = false;
            tokenList.forEach((token, i) => {
                if (result[i].status === "fulfilled")
                    console.log(token, result[i].value);
                else {
                    failedFlag = true;
                    console.error(token, result[i].reason);
                }
            });
            if (failedFlag)
                return reject("Some token transfer has failed");
            floBlockchainAPI.getBalance(oldSinkID).then(floBalance => {
                floTokenAPI.getBalance(oldSinkID).then(cashBalance => {
                    floBlockchainAPI.sendTx(oldSinkID, newSink.floID, floBalance - floGlobals.fee, oldSinkKey, `send ${cashBalance} ${floGlobals.currency}# |Exchange-market New sink`)
                        .then(result => resolve(result))
                        .catch(error => reject(error))
                }).catch(error => reject(error));
            }).catch(error => reject(error))
        });
    })
}
*/

const collectShares = {};
collectShares.retrive = function(floID, sinkID, share) {
    const self = this;
    if (!self.sinkID) {
        self.sinkID = sinkID;
        self.shares = {};
    } else if (self.sinkID !== sinkID)
        return console.error("Something is wrong! Slaves are sending different sinkID");
    if (share.startsWith(SINK_KEY_INDICATOR)) {
        let sinkKey = share.substring(SINK_KEY_INDICATOR.length);
        console.debug("Received sink:", sinkID);
        self.verify(sinkKey);
    } else
        self.shares[floID] = share.split("|");
    try {
        let sinkKey = floCrypto.retrieveShamirSecret([].concat(...Object.values(self.shares)));
        console.debug("Retrived sink:", sinkID);
        self.verify(sinkKey);
    } catch {
        //Unable to retrive sink private key. Waiting for more shares! Do nothing for now
    };
}

collectShares.verify = function(sinkKey) {
    const self = this;
    if (floCrypto.verifyPrivKey(sinkKey, self.sinkID)) {
        let sinkID = self.sinkID;
        console.log("Shares collected successfully for", sinkID);
        self.active = false;
        delete self.sinkID;
        delete self.shares;
        storeSink(sinkID, sinkKey);
        sendSharesToNodes(sinkID, generateShares(sinkKey));
    }
}

function connectWS(floID) {
    let url = nodeURL[floID];
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://' + url);
        ws.on('open', _ => resolve(ws));
        ws.on('error', error => reject(error));
    })
}

function connectToMaster(i = 0, init = false) {
    if (i >= nodeList.length) {
        console.error("No master is found, and myFloID is not in list. This should not happen!");
        process.exit(1);
    }
    let floID = nodeList[i];
    if (floID === myFloID)
        serveAsMaster(init);
    else
        connectWS(floID).then(ws => {
            ws.floID = floID;
            ws.onclose = () => connectToMaster(i);
            serveAsSlave(ws, init);
        }).catch(error => {
            console.log(`Node(${floID}) is offline`);
            connectToMaster(i + 1, init)
        });
}

//Node becomes master
function serveAsMaster(init) {
    console.debug('Starting master process');
    slave.stop();
    mod = MASTER_MODE;
    informLiveNodes(init);
    app.resume();
}

function serveAsSlave(ws, init) {
    console.debug('Starting slave process');
    app.pause();
    slave.start(ws, init);
    mod = SLAVE_MODE;
}

function informLiveNodes(init) {
    let message = {
        floID: global.myFloID,
        type: "UPDATE_MASTER",
        pubKey: global.myPubKey,
        req_time: Date.now()
    };
    message.sign = floCrypto.signData(message.type + "|" + message.req_time, global.myPrivKey);
    message = JSON.stringify(message);
    let nodes = nodeList.filter(n => n !== global.myFloID);
    Promise.allSettled(nodes.map(n => connectWS(n))).then(result => {
        let flag = false;
        for (let i in result)
            if (result[i].status === "fulfilled") {
                let ws = result[i].value;
                ws.send(message);
                ws.close();
                flag = true;
            } else
                console.warn(`Node(${nodes[i]}) is offline`);
        if (init && flag)
            syncRequest();
        //Check if sinkKey or share available in DB
        DB.query("SELECT floID, share FROM sinkShares ORDER BY time_stored DESC LIMIT 1").then(result => {
            if (result.length) {
                let share = Crypto.AES.decrypt(result[0].share, global.myPrivKey);
                if (share.startsWith(SINK_KEY_INDICATOR)) {
                    //sinkKey is already present in DB, use it directly
                    collectShares.active = false;
                    global.sinkPrivKey = share.substring(SINK_KEY_INDICATOR.length);
                    global.sinkID = floCrypto.getFloID(global.sinkPrivKey);
                    if (global.sinkID != result[0].floID) {
                        console.warn("sinkID and sinkKey in DB are not pair!");
                        storeSink(global.sinkID, global.sinkPrivKey);
                    }
                    console.debug("Loaded sink:", global.sinkID);
                    sendSharesToNodes(global.sinkID, generateShares(global.sinkPrivKey))
                } else {
                    //Share is present in DB, try to collect remaining shares and retrive sinkKey
                    collectShares.active = true;
                    collectShares.retrive(global.myFloID, result[0].floID, share);
                }
            } else if (init) {
                if (flag) //Other nodes online, try to collect shares and retrive sinkKey
                    collectShares.active = true;
                else {
                    //No other node is active (possible 1st node to start exchange)
                    console.log("Starting the exchange...");
                    collectShares.active = false;
                    let newSink = floCrypto.generateNewID();
                    console.debug("Generated sink:", newSink.floID, newSink.privKey);
                    storeSink(newSink.floID, newSink.privKey);
                    sendSharesToNodes(newSink.floID, generateShares(newSink.privKey));
                }
            } else //This should not happen!
                console.error("Something is wrong! Node is not starting and no key/share present in DB");
        }).catch(error => console.error(error));
    });
}

function syncRequest(cur = global.myFloID) {
    //Sync data from next available node
    let nextNode = nodeKBucket.nextNode(cur);
    if (!nextNode)
        return console.warn("No nodes available to Sync");
    connectWS(nextNode)
        .then(ws => slave.syncRequest(ws))
        .catch(_ => syncRequest(nextNode));
}

function updateMaster(floID) {
    let currentMaster = mod === MASTER_MODE ? global.myFloID : slave.masterWS.floID;
    if (nodeList.indexOf(floID) < nodeList.indexOf(currentMaster))
        connectToMaster();
}

function slaveConnect(floID, pubKey, ws) {
    ws.floID = floID;
    ws.pubKey = pubKey;
    connectedSlaves[floID] = ws;
    if (collectShares.active)
        ws.send(JSON.stringify({
            command: "SEND_SHARE",
            pubKey: global.myPubKey
        }));
    else if (nodeShares === null || //The 1st backup is connected
        Object.keys(connectedSlaves).length < Math.pow(SHARE_THRESHOLD, 2) * Object.keys(nodeShares).length) //re-calib shares for better 
        sendSharesToNodes(global.sinkID, generateShares(global.sinkPrivKey))
    else if (nodeShares[floID])
        sendShare(ws, global.sinkID, nodeShares[floID]);
}

//Transmistter
function startBackupTransmitter(server) {
    wss = new WebSocket.Server({
        server
    });
    wss.on('connection', ws => {
        ws.on('message', message => {
            //verify if from a backup node
            try {
                let invalid = null,
                    request = JSON.parse(message);
                //console.debug(request);
                if (!nodeList.includes(request.floID))
                    invalid = `floID ${request.floID} not in nodeList`;
                else if (request.floID !== floCrypto.getFloID(request.pubKey))
                    invalid = "Invalid pubKey";
                else if (!floCrypto.verifySign(request.type + "|" + request.req_time, request.sign, request.pubKey))
                    invalid = "Invalid signature";
                //TODO: check if request time is valid;
                else switch (request.type) {
                    case "BACKUP_SYNC":
                        sync.sendBackupData(request.last_time, request.checksum, ws);
                        break;
                    case "HASH_SYNC":
                        sync.sendTableHash(request.tables, ws);
                        break;
                    case "RE_SYNC":
                        sync.sendTableData(request.tables, ws);
                        break;
                    case "UPDATE_MASTER":
                        updateMaster(request.floID);
                        break;
                    case "SLAVE_CONNECT":
                        slaveConnect(request.floID, request.pubKey, ws);
                        break;
                    case "SINK_SHARE":
                        collectShares.retrive(request.floID, request.sinkID, floCrypto.decryptData(request.share, global.myPrivKey))
                    default:
                        invalid = "Invalid Request Type";
                }
                if (invalid)
                    ws.send(JSON.stringify({
                        type: request.type,
                        command: "REQUEST_ERROR",
                        error: invalid
                    }));
            } catch (error) {
                console.error(error);
                ws.send(JSON.stringify({
                    command: "REQUEST_ERROR",
                    error: 'Unable to process the request!'
                }));
            }
        });
        ws.on('close', () => {
            // remove from connected slaves (if needed)
            if (ws.floID in connectedSlaves)
                delete connectedSlaves[ws.floID];
        })
    });
}

function initProcess(a) {
    app = a;
    startBackupTransmitter(app.server);
    connectToMaster(0, true);
}

module.exports = {
    init: initProcess,
    set nodeList(list) {
        nodeURL = list;
        nodeKBucket = new K_Bucket(floGlobals.adminID, Object.keys(nodeURL));
        nodeList = nodeKBucket.order;
    },
    set assetList(assets) {
        tokenList = assets.filter(a => a.toUpperCase() !== "FLO");
    },
    set DB(db) {
        DB = db;
        sync.DB = db;
        slave.DB = db;
    },
    get wss() {
        return wss;
    }
};