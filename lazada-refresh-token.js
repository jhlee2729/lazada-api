const config = require('../config');
const env = require('./env').env;
const pool = require('./connection-pool').createPool(config[env].database);
const dateformat = require('dateformat');
const crypto = require('crypto');
const axios = require('axios');

const syncData = { 
    app_key: '',
    app_secret:'',
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
                throw err;
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

        execute(`SELECT 
                    app_key, 
                    app_secret,
                    access_token,
                    expires_in,
                    expires_in_time,
                    refresh_token,
                    refresh_token_expires_in,
                    refresh_token_expires_in_time 
                FROM app_lazada_sync
                GROUP BY app_key, app_secret, access_token, expires_in, expires_in_time, refresh_token, refresh_token_expires_in, refresh_token_expires_in_time`, (err,rows) => {
            if (err) {
                throw err;
            } else {

                let count = rows.length;
                let check = 0;

                const goway = () => { 

                    if ( count != check ) {
                        refreshAccessToken(rows[check++], goway, check==count);

                    } else {
                        resolve();
                    }
                }
                goway();
            }
        });
    });
}

const refreshAccessToken = (syncData, callback, bool) => {
    return new Promise((resolve,reject) => {

        let app_key = syncData.app_key;
        let app_secret = syncData.app_secret;
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

            console.log(`app_key : ${app_key}, acess_token ${response.data.expires_in}, refresh_expires_in : ${response.data.refresh_expires_in}`);

            let access_token = response.data.access_token;
            let refresh_token = response.data.refresh_token;
            let now = new Date().getTime();

            //access_token 604800
            let expires_in = response.data.expires_in;
            let expires_in_time = dateformat(now + (expires_in * 1000),'yyyy-mm-dd HH:MM:ss'); // ms * 1000 = sec
            
            //refresh_token 2592000
            let refresh_token_expires_in = response.data.refresh_expires_in;
            let refresh_token_expires_in_time = dateformat(now + (refresh_token_expires_in * 1000),'yyyy-mm-dd HH:MM:ss');

            // console.log(`====RESPONSE=== ${expires_in}, ${refresh_token_expires_in}========`);
            // console.log(`========== ${expires_in_time}, ${refresh_token_expires_in_time}========`);
            
            execute(`UPDATE app_lazada_sync
                    SET
                    access_token="${access_token}",
                    expires_in="${expires_in}",
                    expires_in_time="${expires_in_time}",
                    refresh_token="${refresh_token}",
                    refresh_token_expires_in="${refresh_token_expires_in}",
                    refresh_token_expires_in_time="${refresh_token_expires_in_time}"
                    WHERE app_key = "${app_key}"
                    `,
                    (err,rows) => {
                        if (err) {
                            throw err;
                        } else {

                            if(!bool){
                                callback();
                                return;
                            }

                            resolve();
                            console.log(new Date() + '종료');
                            closing();
                        }
            })
        }).catch((err) => {
            closing();
            console.log(err)            
        })

        resolve();
    })
}

const worker = async() => { 

    try {

        console.log(new Date() + '시작');
        await getLazadaSync();
    } catch(e){
        console.log(e)
    }
}

worker();

