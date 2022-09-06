const config = require('../config');
const env = require('./env').env;
const pool = require('./connection-pool').createPool(config[env].database);
const dateformat = require('dateformat');
const crypto = require('crypto');
const axios = require('axios');

const syncData = { 
    market: '',
    access_token: '',
    expires_in: 0,
    expires_in_time: '',
    refresh_token: '',
    refresh_token_expires_in: 0,
    refresh_token_expires_in_time: ''
}

const execute = (sql,callback,data = {})=>{
    
    pool.getConnection((err,connection) => {
        if (err) throw err;

        connection.query(sql,data,(err,rows) => {
            connection.release();

            if ( err ) {
                error_hook(syncData.market,err,(e,res) => {
                    throw err;
                });
            } else {
                callback(err, rows);
            }
        });
    });
}

const closing = () => {
    pool.end();
}

const getLazadaSync = () => {
    return new Promise((resolve,reject)=>{

        execute(`SELECT * FROM app_lazada_sync`,(err,rows) => {
            if (err) {
                throw err;
            } else {

                syncData.access_token = rows[0].access_token;
                syncData.expires_in = rows[0].expires_in;
                syncData.expires_in_time = rows[0].expires_in_time;
                syncData.refresh_token = rows[0].refresh_token;
                syncData.refresh_token_expires_in = rows[0].refresh_token_expires_in;
                syncData.refresh_token_expires_in_time = rows[0].refresh_token_expires_in_time;
                resolve();
            }
        });
    });
}

const refreshAccessToken = () => {
    return new Promise((resolve,reject) => {

        let app_key = "111424";
        let app_secret = "nDF06KuA5wpGuhTqHKePvOUjcVzEHuGa";
        let refresh_token = syncData.refresh_token;
        let access_token = syncData.access_token;
        let timestamp = new Date().getTime().toString();
        let sign_method = "sha256";

        let sign_format = `/auth/token/refreshaccess_token${access_token}app_key${app_key}refresh_token${refresh_token}sign_method${sign_method}timestamp${timestamp}`;
        sign_format = sign_format.toString();

        const sign = crypto.createHmac('sha256', app_secret).update(sign_format).digest('hex').toUpperCase();

        axios({
            method: 'GET',
            url : 'https://api.lazada.com.my/rest/auth/token/refresh',
            params: {
                app_key: app_key,
                timestamp: timestamp,
                access_token: access_token,
                refresh_token: refresh_token,
                sign_method: sign_method,
                sign: sign
            }
    
        }).then((response) => {

            let access_token = response.data.access_token;
            let refresh_token = response.data.refresh_token;
            let now = new Date().getTime();

            //access_token
            let expires_in = response.data.expires_in;
            let expires_in_time = dateformat(now + (expires_in * 1000),'yyyy-mm-dd HH:MM:ss'); // ms * 1000 = sec
            
            //refresh_token
            let refresh_token_expires_in = response.data.refresh_expires_in;
            let refresh_token_expires_in_time = dateformat(now + (refresh_token_expires_in * 1000),'yyyy-mm-dd HH:MM:ss');
            
            execute(`UPDATE app_lazada_sync
                    SET
                    access_token="${access_token}",
                    expires_in="${expires_in}",
                    expires_in_time="${expires_in_time}",
                    refresh_token="${refresh_token}",
                    refresh_token_expires_in="${refresh_token_expires_in}",
                    refresh_token_expires_in_time="${refresh_token_expires_in_time}"
                    `,
                    (err,rows) => {
                        if (err) {
                            throw err;
                        } else {
                            resolve();
                            console.log(new Date() + '종료');
                            closing();
                        }
            })
        }).catch((err) => {
            closing();
            console.log(err)            
        })
    })
}

const worker = async() => { 

    try {
        console.log(new Date() + '시작');
        await getLazadaSync();
        await refreshAccessToken();

    } catch(e){
        console.log(e)
    }
}

worker();

