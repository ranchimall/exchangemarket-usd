'use strict';
const express = require('express');
//const cookieParser = require("cookie-parser");
//const sessions = require('express-session');
const Request = require('./request');
const path = require('path');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'docs');

module.exports = function App(secret) {

    if (!(this instanceof App))
        return new App(secret);

    var server = null;
    const app = express();
    //session middleware
    /*app.use(sessions({
        secret: secret,
        saveUninitialized: true,
        resave: false,
        name: "session"
    }));*/
    // parsing the incoming data
    app.use(express.json());
    app.use(express.urlencoded({
        extended: true
    }));
    //serving public file
    app.use(express.static(PUBLIC_DIR));
    // cookie parser middleware
    //app.use(cookieParser());

    /* Decentralising - Users will load from user-end files and request via APIs only
    //Initital page loading
    app.get('/', (req, res) => res.sendFile('home.html', {
        root: PUBLIC_DIR
    }));
    */

    app.use(function (req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', "*");
        // Request methods you wish to allow
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        // Request headers you wish to allow
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        // Pass to next layer of middleware
        next();
    })

    //get code for login
    app.get('/get-login-code', Request.GetLoginCode);

    //login request
    app.post('/login', Request.Login);

    //logout request
    app.post('/logout', Request.Logout);

    //place sell or buy order
    app.post('/buy', Request.PlaceBuyOrder);
    app.post('/sell', Request.PlaceSellOrder);

    //cancel sell or buy order
    app.post('/cancel', Request.CancelOrder);

    //transfer amount to another user
    app.post('/transfer-token', Request.TransferToken);

    //list all orders and trades
    app.get('/list-sellorders', Request.ListSellOrders);
    app.get('/list-buyorders', Request.ListBuyOrders);
    app.get('/list-trades', Request.ListTradeTransactions);

    //get rates, balance and tx
    app.get('/get-rates', Request.GetRates);
    app.get('/rate-history', Request.GetRateHistory);
    app.get('/get-balance', Request.GetBalance);
    app.get('/get-transaction', Request.GetTransaction);
    app.get('/get-sink', Request.GetSink);

    //get account details
    app.post('/account', Request.Account);

    //withdraw and deposit request
    app.post('/deposit-flo', Request.DepositFLO);
    app.post('/withdraw-flo', Request.WithdrawFLO);
    app.post('/deposit-token', Request.DepositToken);
    app.post('/withdraw-token', Request.WithdrawToken);
    app.post('/get-transact', Request.GetUserTransacts);

    //generate or discard sinks (admin only)
    app.post('/generate-sink', Request.GenerateSink);
    app.post('/reshare-sink', Request.ReshareSink);
    app.post('/discard-sink', Request.DiscardSink);

    //convert from or to coin
    app.get('/get-convert-values', Request.GetConvertValues);
    app.post('/convert-to', Request.ConvertTo);
    app.post('/convert-from', Request.ConvertFrom);
    app.post('/deposit-convert-coin-fund', Request.DepositConvertCoinFund);
    app.post('/deposit-convert-currency-fund', Request.DepositConvertCurrencyFund);
    app.post('/withdraw-convert-coin-fund', Request.WithdrawConvertCoinFund);
    app.post('/withdraw-convert-currency-fund', Request.WithdrawConvertCurrencyFund);

    //close blockchain-bond and bobs-fund-investment
    app.post('/close-blockchain-bonds', Request.CloseBlockchainBond);
    app.post('/close-bobs-fund-investment', Request.CloseBobsFund);

    //check balance for blockchain-bond and bobs-fund (trusted IDs only)
    app.post('/check-blockchain-bond', Request.CheckBlockchainBondBalance);
    app.post('/check-bobs-fund', Request.CheckBobsFundBalance);

    //Manage user tags (trusted IDs only)
    app.post('/add-tag', Request.AddUserTag);
    app.post('/remove-tag', Request.RemoveUserTag);
    app.post('/add-distributor', Request.AddDistributor);
    app.post('/remove-distributor', Request.RemoveDistributor);

    Request.secret = secret;

    //Properties
    let self = this;

    //return server, express-app
    Object.defineProperty(self, "server", {
        get: () => server
    });
    Object.defineProperty(self, "express", {
        get: () => app
    });

    //set trustedID for subAdmin requests
    Object.defineProperty(self, "trustedIDs", {
        set: (ids) => Request.trustedIDs = ids
    });

    Object.defineProperty(self, "assetList", {
        set: (assets) => Request.assetList = assets
    });

    //Refresh data (from blockchain)
    self.refreshData = (nodeList) => Request.refreshData(nodeList);

    //Start (or) Stop servers
    self.start = (port) => new Promise(resolve => {
        server = app.listen(port, () => {
            resolve(`Server Running at port ${port}`);
        });
    });
    self.stop = () => new Promise(resolve => {
        server.close(() => {
            server = null;
            resolve('Server stopped');
        });
    });

    //(Node is not master) Pause serving the clients
    self.pause = () => Request.pause();
    //(Node is master) Resume serving the clients
    self.resume = () => Request.resume();

}