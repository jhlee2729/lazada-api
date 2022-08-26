const config = require('../config');
const env = require('./env').env;
const pool = require('./connection-pool').createPool(config[env].database);
const dateformat = require('dateformat');
const crypto = require('crypto');
const axios = require('axios');

const syncData = { 
    app_key: '',
    app_secret: '',
    endpoints: '',
    access_token: '',
    expires_in: 0,
    expires_in_time: '',
    refresh_token: '',
    refresh_token_expires_in: 0,
    refresh_token_expires_in_time: ''
}

const contents = {
    after: 0,
    before: 0,
    market: '',
    country: '',
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

const signature = (sign_format) => {

    const sign = crypto.createHmac('sha256', syncData.app_secret).update(sign_format).digest('hex').toUpperCase();
    return sign;
}

const lastCreateTimeTo = () => {
    return new Promise((resolve,reject) => {
        execute(`SELECT time_to 
            FROM app_lazada_api_history 
            WHERE country="${contents.country}" ORDER BY api_history_id DESC LIMIT 0,1`, 
            (err,rows) => {

                if (err) {
                    throw err;
                } else {

                    let now = new Date(); // 현재시간
                    let time = now.getTime().toString(); // 현재 시간을 밀리초로 환산 후 string으로 타입 변경
                    let time_result = Number(time.substr(0, time.length - 3)); // 밀리초 -> 초

                    if ( rows.length >= 1 ) {

                        // let after = new Date(rows[0].time_to).toISOString(); // 밀리초로 환산 후 ISO 8601 date format
                        let after = rows[0].time_to; // 시작시간(DB 최근 time_to 값)

                        // * after(이상) ... before(미만) 
                        contents.after = after; 
                        contents.before = new Date(Number((time_result) + '000')).toISOString();

                        console.log("contents", contents)
                        resolve();

                    } else {
                        contents.after = time_result - 86400; // 현재시간으로 부터 1시간 이전 주문 취합
                        contents.before = time_result ;
                        resolve();
                    }
                }
        })
    })
}

const getOrders = () => {
    return new Promise((resolve,reject) => {

        // console.log("new Date()", new Date()) //2022-08-25T10:22:57.535Z
        // console.log("Date()", Date());
        const app_key = syncData.app_key;
        const access_token = syncData.access_token;
        const timestamp = new Date().getTime().toString();
        const sign_method = "sha256";
        const created_after = contents.after;
        const created_before = contents.before;
        const limit = "100";
        // const status = "pending";
        
        let sign_format = `/orders/getaccess_token${access_token}app_key${app_key}created_after${created_after}created_before${created_before}limit${limit}sign_method${sign_method}timestamp${timestamp}`;
        sign_format = sign_format.toString();
    
        let sign = signature(sign_format)
    
        axios({
            method: 'GET',
            url : syncData.endpoints+'/orders/get',
            params: {
                app_key: app_key,
                timestamp: timestamp,
                access_token:access_token,
                sign_method:sign_method,
                sign: sign,
                created_after:created_after,
                created_before:created_before,
                limit:limit
            }
    
        }).then((response) => {
    
            // console.log("response", response.data.data.countTotal);
            // console.log("response", response.data);
            console.log("response", response.data);
            // console.log("response", response.data.data.orders);
            resolve();
        }).catch((err) => {
    
            console.log("err", err);
    
        })

    })
}

const connectionClose = (callback,bool) => {
    return new Promise((resolve,reject) => {

        // console.log(insertData.createOrder.length);
        // console.log(insertData.updateOrder.length);
        console.log(new Date() + ' 종료');
        console.log('=====================================================================');
        console.timeEnd();
        // console.log(bool);
        if ( bool ) {
            closing();
        }
        callback();
    });
}

const worker = async (sync,callback,bool) => { 

    try {
        
        console.log('=====================================================================');
        console.log(new Date() + ' 시작');
        console.time();

        syncData.app_key = sync.app_key;
        syncData.app_secret = sync.app_secret;
        syncData.endpoints = sync.endpoints;
        syncData.access_token = sync.access_token;
        syncData.expires_in = sync.expires_in;
        syncData.expires_in_time = sync.expires_in_time;
        syncData.refresh_token = sync.refresh_token;
        syncData.refresh_token_expires_in = sync.refresh_token_expires_in;
        syncData.refresh_token_expires_in_time = sync.refresh_token_expires_in_time;
        
        contents.market = sync.market;
        contents.country = sync.country;
        
        await lastCreateTimeTo();

        await getOrders();
        await connectionClose(callback,bool);

    } catch(e){
        console.log(e)
    }
}

module.exports = worker;