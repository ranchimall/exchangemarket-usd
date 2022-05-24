(function(EXPORTS) { //floTokenAPI v1.0.3a
    /* Token Operator to send/receive tokens via blockchain using API calls*/
    'use strict';
    const tokenAPI = EXPORTS;

    const DEFAULT = {
        apiURL: floGlobals.tokenURL || "https://ranchimallflo.duckdns.org/",
        currency: "rupee"
    }

    Object.defineProperties(tokenAPI, {
        URL: {
            get: () => DEFAULT.apiURL
        },
        currency: {
            get: () => DEFAULT.currency,
            set: currency => DEFAULT.currency = currency
        }
    });

    if (floGlobals.currency) tokenAPI.currency = floGlobals.currency;

    const fetch_api = tokenAPI.fetch = function(apicall) {
        return new Promise((resolve, reject) => {
            console.log(DEFAULT.apiURL + apicall);
            fetch(DEFAULT.apiURL + apicall).then(response => {
                if (response.ok)
                    response.json().then(data => resolve(data));
                else
                    reject(response)
            }).catch(error => reject(error))
        })
    }

    const getBalance = tokenAPI.getBalance = function(floID, token = DEFAULT.currency) {
        return new Promise((resolve, reject) => {
            fetch_api(`api/v1.0/getFloAddressBalance?token=${token}&floAddress=${floID}`)
                .then(result => resolve(result.balance || 0))
                .catch(error => reject(error))
        })
    }

    tokenAPI.getTx = function(txID) {
        return new Promise((resolve, reject) => {
            fetch_api(`api/v1.0/getTransactionDetails/${txID}`).then(res => {
                if (res.result === "error")
                    reject(res.description);
                else if (!res.parsedFloData)
                    reject("Data piece (parsedFloData) missing");
                else if (!res.transactionDetails)
                    reject("Data piece (transactionDetails) missing");
                else
                    resolve(res);
            }).catch(error => reject(error))
        })
    }

    tokenAPI.sendToken = function(privKey, amount, receiverID, message = "", token = DEFAULT.currency, options = {}) {
        return new Promise((resolve, reject) => {
            let senderID = floCrypto.getFloID(privKey);
            if (typeof amount !== "number" || isNaN(amount) || amount <= 0)
                return reject("Invalid amount");
            getBalance(senderID, token).then(bal => {
                if (amount > bal)
                    return reject(`Insufficient ${token}# balance`);
                floBlockchainAPI.writeData(senderID, `send ${amount} ${token}# ${message}`, privKey, receiverID, options)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }

    tokenAPI.getAllTxs = function(floID, token = DEFAULT.currency) {
        return new Promise((resolve, reject) => {
            fetch_api(`api/v1.0/getFloAddressTransactions?token=${token}&floAddress=${floID}`)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    }

    const util = tokenAPI.util = {};

    util.parseTxData = function(txData) {
        let parsedData = {};
        for (let p in txData.parsedFloData)
            parsedData[p] = txData.parsedFloData[p];
        parsedData.sender = txData.transactionDetails.vin[0].addr;
        for (let vout of txData.transactionDetails.vout)
            if (vout.scriptPubKey.addresses[0] !== parsedData.sender)
                parsedData.receiver = vout.scriptPubKey.addresses[0];
        parsedData.time = txData.transactionDetails.time;
        return parsedData;
    }

})('object' === typeof module ? module.exports : window.floTokenAPI = {});