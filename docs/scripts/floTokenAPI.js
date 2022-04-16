'use strict';

/* Token Operator to send/receive tokens from blockchain using API calls*/
(function(GLOBAL) {
    const floTokenAPI = GLOBAL.floTokenAPI = {
        fetch_api: function(apicall) {
            return new Promise((resolve, reject) => {
                console.log(floGlobals.tokenURL + apicall);
                fetch(floGlobals.tokenURL + apicall).then(response => {
                    if (response.ok)
                        response.json().then(data => resolve(data));
                    else
                        reject(response)
                }).catch(error => reject(error))
            })
        },
        getBalance: function(floID, token = floGlobals.currency) {
            return new Promise((resolve, reject) => {
                this.fetch_api(`api/v1.0/getFloAddressBalance?token=${token}&floAddress=${floID}`)
                    .then(result => resolve(result.balance || 0))
                    .catch(error => reject(error))
            })
        },
        getTx: function(txID) {
            return new Promise((resolve, reject) => {
                this.fetch_api(`api/v1.0/getTransactionDetails/${txID}`).then(res => {
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
        },
        sendToken: function(privKey, amount, receiverID, message = "", token = floGlobals.currency) {
            return new Promise((resolve, reject) => {
                let senderID = floCrypto.getFloID(privKey);
                if (typeof amount !== "number" || amount <= 0)
                    return reject("Invalid amount");
                this.getBalance(senderID, token).then(bal => {
                    if (amount > bal)
                        return reject(`Insufficient ${token}# balance`);
                    floBlockchainAPI.writeData(senderID, `send ${amount} ${token}# ${message}`, privKey, receiverID)
                        .then(txid => resolve(txid))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
            });
        }
    }
})(typeof global !== "undefined" ? global : window);