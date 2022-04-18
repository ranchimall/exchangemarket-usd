'use strict';
var mysql = require('mysql');

function Database(user, password, dbname, host = 'localhost') {
    const db = {};

    Object.defineProperty(db, "connect", {
        get: () => new Promise((resolve, reject) => {
            db.pool.getConnection((error, conn) => {
                if (error)
                    reject(error);
                else
                    resolve(conn);
            });
        })
    });

    Object.defineProperty(db, "query", {
        value: (sql, values) => new Promise((resolve, reject) => {
            db.connect.then(conn => {
                const fn = (err, res) => {
                    conn.release();
                    (err ? reject(err) : resolve(res));
                };
                if (values)
                    conn.query(sql, values, fn);
                else
                    conn.query(sql, fn);
            }).catch(error => reject(error));
        })
    });

    Object.defineProperty(db, "transaction", {
        value: (queries) => new Promise((resolve, reject) => {
            db.connect.then(conn => {
                conn.beginTransaction(err => {
                    if (err)
                        conn.rollback(() => {
                            conn.release();
                            reject(err);
                        });
                    else {
                        (function queryFn(result) {
                            if (!queries.length) {
                                conn.commit(err => {
                                    if (err)
                                        conn.rollback(() => {
                                            conn.release();
                                            reject(err);
                                        });
                                    else {
                                        conn.release();
                                        resolve(result);
                                    }
                                });
                            } else {
                                let q_i = queries.shift();
                                const callback = function(err, res) {
                                    if (err)
                                        conn.rollback(() => {
                                            conn.release();
                                            reject(err);
                                        });
                                    else {
                                        result.push(res);
                                        queryFn(result);
                                    }
                                };
                                if (!Array.isArray(q_i))
                                    q_i = [q_i];
                                if (q_i[1])
                                    conn.query(q_i[0], q_i[1], callback);
                                else
                                    conn.query(q_i[0], callback);
                            }
                        })([]);
                    }
                });
            }).catch(error => reject(error));
        })
    });

    return new Promise((resolve, reject) => {
        db.pool = mysql.createPool({
            host: host,
            user: user,
            password: password,
            database: dbname,
            //dateStrings : true,
            //timezone: 'UTC'
        });
        db.connect.then(conn => {
            conn.release();
            resolve(db);
        }).catch(error => reject(error));
    });
}

module.exports = Database;