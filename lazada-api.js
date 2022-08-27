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
    order_ids: []
}

const insertData = {
    createOrder: [],
    createOrderDetails: [],
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

const createOrder = () => {
    return new Promise((resolve,reject) => {

        let app_key = syncData.app_key;
        let access_token = syncData.access_token;
        let timestamp = new Date().getTime().toString();
        let sign_method = "sha256";
        let created_after = contents.after;
        let created_before = contents.before;
        let offset = 0;
        let limit = 100;
    
        const getOrder = () => {
     
            console.log(`offset: ${offset}, limit :${limit}`)
            
            let sign_format = `/orders/getaccess_token${access_token}app_key${app_key}created_after${created_after}created_before${created_before}limit${limit}offset${offset}sign_method${sign_method}timestamp${timestamp}`;
            sign_format = sign_format.toString();
        
            let sign = signature(sign_format);

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
                    limit:limit,
                    offset:offset
                }
            }).then((response) => {
            
                let count = response.data.data.count;
                let count_total = response.data.data.countTotal;

                insertData.createOrder = insertData.createOrder.concat(response.data.data.orders);

                response.data.data.orders.forEach(element => {
                    contents.order_ids.push(element.order_id)
                })

                // console.log("contents.order_ids",contents.order_ids)
                console.log("count", count);
                console.log("count_total", count_total);
                console.log("insertData", insertData.createOrder.length);
                // console.log("orders", response.data.data.orders[0].order_id);
                
                if ( count_total-count !== offset) {
                    offset += limit;
                    getOrder();
                    
                } else {
                    resolve();
                }
                
            }).catch((err) => {
                console.log("err", err);
                resolve(false);
            })
        }
        
        getOrder();
    })
}

const createOrderDetails = () => {
    return new Promise((resolve,reject) => {
        
        let app_key = syncData.app_key;
        let access_token = syncData.access_token;
        let timestamp = new Date().getTime().toString();
        let sign_method = "sha256";
        let order_ids = "[343380064275872, 344993388730300, 344991186653673, 344997193393431,343393045659043, 345020523233385, 345029312160222, 344980796644174,345016141349351, 345009557776146, 343394280914931, 343407646986540,344995192092113, 343405449434790, 343379485957285, 345011553238820,344988599013977, 343388087453551, 343392492510052, 343417220965736,343407242537962, 343406247237962, 345001392941040, 343420823952348,343406042047501, 343392865479081, 345030526220188, 343405864999511,345036116620697, 343387679952361, 343389489050417, 343393484619842,343433812974208, 345023750492223, 343386484939395, 345013566408065,343414661677804, 343399087666381, 343436405667124, 345044309417301,343406870415751, 343440607498456, 343414461088308, 343415448094218,343440609518107, 345018962644841, 343395091791441, 345057305785448,345024155981197, 345060303539741, 343430428364244, 343426235619784,343406888756429, 345053516580685, 345035154350415, 343413299588489,343415464700169, 343413854311353, 343421275175418, 345063103944164,345046533654105, 345031958564632, 345014595399438, 343446222587228,345046723474289, 345051914586874, 343414695776235, 345042739195688,343444623999438, 345020375030474, 343455202167442, 343423044911678,345020382554737, 345031976180488, 345069311012090, 343451615904452,345059335504452, 343432686654478, 343426478804452, 343432266584280,345086902486389, 343474204980472, 343454627512529]";

        // let order_ids = '"['+contents.order_ids+']"';


        const getOrderDetails = () => {

            let sign_format = `/orders/items/getaccess_token${access_token}app_key${app_key}order_ids${order_ids}sign_method${sign_method}timestamp${timestamp}`;
            sign_format = sign_format.toString();
        
            let sign = signature(sign_format);

            axios({
                method: 'GET',
                url : syncData.endpoints+'/orders/items/get',
                params: {
                    app_key: app_key,
                    timestamp: timestamp,
                    access_token:access_token,
                    sign_method:sign_method,
                    sign: sign,
                    order_ids: order_ids
                }
            }).then((response) => {
                console.log("response", response.data)

            }).catch((err) => {
                console.log("err", err);
                resolve(false);
            })
        }

        getOrderDetails();

    });
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
        const success1 = await createOrder();
        await createOrderDetails();

        if ( !success1 ) {
            await connectionClose(callback,bool);
            return;
        }

        await connectionClose(callback,bool);

    } catch(e){
        console.log(e)
    }
}

module.exports = worker;