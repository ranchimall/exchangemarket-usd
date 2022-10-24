'use strict';

const K_Bucket = require('../../docs/scripts/floExchangeAPI').K_Bucket;
const slave = require('./slave');
const sync = require('./sync');
const WebSocket = require('ws');

const {
    SHARE_THRESHOLD
} = require("../_constants")["backup"];

var DB, app, wss, tokenList; //Container for database and app
var nodeList, nodeURL, nodeKBucket; //Container for (backup) node list
const connectedSlaves = {},
    shares_collected = {},
    shares_pending = {};
var _mode = null;
const SLAVE_MODE = 0,
    MASTER_MODE = 1;

const sinkList = {};

const chests = {
    get list() {
        return Object.keys(sinkList);
    },
    get activeList() {
        let result = [];
        for (let id in sinkList)
            if (sinkList[id])
                result.push(id);
        return result;
    },
    includes(id) {
        return (id in sinkList);
    },
    isActive(id) {
        return (id in sinkList && sinkList[id] !== null);
    },
    get pick() {
        let sinks = Object.keys(sinkList),
            i = floCrypto.randInt(0, sinks.length);
        return sinks[i];
    }
};

//Shares
function generateShares(sinkKey) {
    let nextNodes = nodeKBucket.nextNode(global.myFloID, null),
        aliveNodes = Object.keys(connectedSlaves);
    nextNodes.unshift(global.myFloID);
    aliveNodes.unshift(global.myFloID);
    let N = nextNodes.length + 1,
        th = Math.ceil(aliveNodes.length * SHARE_THRESHOLD) + 1,
        shares, refShare, mappedShares = {};
    shares = floCrypto.createShamirsSecretShares(sinkKey, N, th);
    refShare = shares.pop();
    for (let i in nextNodes)
        mappedShares[nextNodes[i]] = [refShare, shares[i]].join("|");
    return mappedShares;
}

function sendShare(ws, sinkID, keyShare) {
    if (shares_pending[sinkID][ws.floID] === keyShare) //this should always be true unless there is an error
        delete shares_pending[sinkID][ws.floID]; //delete the share after sending it to respective slave
    ws.send(JSON.stringify({
        command: "SINK_SHARE",
        sinkID,
        keyShare: floCrypto.encryptData(keyShare, ws.pubKey)
    }));
}

function sendSharesToNodes(sinkID, shares) {
    shares_pending[sinkID] = shares;
    for (let node in shares)
        if (node in connectedSlaves)
            sendShare(connectedSlaves[node], sinkID, shares[node]);
    if (global.myFloID in shares) {
        slave.storeShare(sinkID, shares[global.myFloID], false);
        delete shares_pending[sinkID][global.myFloID];
    }
    sinkList[sinkID] = Date.now();
}

function requestShare(ws, sinkID) {
    ws.send(JSON.stringify({
        command: "SEND_SHARE",
        sinkID: sinkID,
        pubKey: global.myPubKey
    }));
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

function collectAndCall(sinkID, callback, timeout = null) {
    if (!(callback instanceof Function))
        throw Error("callback should be a function");
    if (!(sinkID in shares_collected)) { //if not already collecting shares for sinkID, then initiate collection
        shares_collected[sinkID] = {
            callbacks: [],
            shares: {}
        };
        for (let floID in connectedSlaves)
            requestShare(connectedSlaves[floID], sinkID);
        DB.query("SELECT share FROM sinkShares WHERE floID=?", [sinkID]).then(result => {
            if (result.length)
                collectShares(myFloID, sinkID, Crypto.AES.decrypt(result[0].share, global.myPrivKey))
        }).catch(error => console.error(error))
    }
    shares_collected[sinkID].callbacks.push(callback);
    if (timeout)
        setTimeout(() => {
            if (sinkID in shares_collected) {
                let i = shares_collected[sinkID].callbacks.indexOf(callback);
                delete shares_collected[sinkID].callbacks[i]; //deleting will empty the index, but space will be there so that order of other indexes are not affected
            }
        }, timeout);
}

collectAndCall.isAlive = (sinkID, callbackRef) => (sinkID in shares_collected && shares_collected[sinkID].callbacks.indexOf(callbackRef) != -1);

function collectShares(floID, sinkID, share) {
    if (_mode !== MASTER_MODE)
        return console.warn("Not serving as master");
    if (!(sinkID in shares_collected))
        return console.error("Something is wrong! Slaves are sending sinkID thats not been collected");
    shares_collected[sinkID].shares[floID] = share.split("|");
    try {
        let sinkKey = floCrypto.retrieveShamirSecret([].concat(...Object.values(shares_collected[sinkID].shares)));
        if (floCrypto.verifyPrivKey(sinkKey, sinkID)) {
            console.log("Shares collected successfully for", sinkID);
            shares_collected[sinkID].callbacks.forEach(fn => fn instanceof Function ? fn(sinkKey) : null);
            delete shares_collected[sinkID];
        }
    } catch {
        //Unable to retrive sink private key. Waiting for more shares! Do nothing for now
    };
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
    _mode = MASTER_MODE;
    informLiveNodes(init);
    app.resume();
}

function serveAsSlave(ws, init) {
    console.debug('Starting slave process');
    app.pause();
    slave.start(ws, init);
    _mode = SLAVE_MODE;
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
        DB.query("SELECT floID, share FROM sinkShares ORDER BY time_stored DESC").then(result => {
            if (result.length)
                result.forEach(r => reconstructShares(r.floID));
            else if (!flag) {
                console.log("Starting the exchange...");
                let newSink = floCrypto.generateNewID();
                console.debug("Generated sink:", newSink.floID, newSink.privKey);
                sendSharesToNodes(newSink.floID, generateShares(newSink.privKey));
            }
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
    let currentMaster = _mode === MASTER_MODE ? global.myFloID : slave.masterWS.floID;
    if (nodeList.indexOf(floID) < nodeList.indexOf(currentMaster))
        connectToMaster();
}

function reconstructShares(sinkID) {
    if (_mode !== MASTER_MODE)
        return console.warn("Not serving as master");
    sinkList[sinkID] = null;
    collectAndCall(sinkID, sinkKey => sendSharesToNodes(sinkID, generateShares(sinkKey)));
}

function slaveConnect(floID, pubKey, ws, sinks) {
    if (_mode !== MASTER_MODE)
        return console.warn("Not serving as master");
    ws.floID = floID;
    ws.pubKey = pubKey;
    connectedSlaves[floID] = ws;

    //Send shares if need to be delivered
    for (let sinkID in shares_pending)
        if (floID in shares_pending[sinkID])
            sendShare(ws, sinkID, shares_pending[floID]);
    //Request shares if any
    for (let sinkID in shares_collected)
        requestShare(ws, sinkID); //if (!(floID in shares_collected[sinkID].shares))
    //check if sinks in slaves are present
    if (Array.isArray(sinks))
        for (let sinkID of sinks)
            if (!(sinkID in sinkList))
                reconstructShares(sinkID);
    /*
    if (shares_pending === null || //The 1st backup is connected
        Object.keys(connectedSlaves).length < Math.pow(SHARE_THRESHOLD, 2) * Object.keys(shares_pending).length) //re-calib shares for better 
        sendSharesToNodes(sinkID, generateShares(sinkPrivKey))
    */
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
                        slaveConnect(request.floID, request.pubKey, ws, request.sinks);
                        break;
                    case "SINK_SHARE":
                        collectShares(request.floID, request.sinkID, floCrypto.decryptData(request.share, global.myPrivKey))
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
    app.chests = chests;
    app.collectAndCall = collectAndCall;
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
    get nodeList() {
        return nodeList;
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