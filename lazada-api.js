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
    updateOrder: [],
    updateOrderDetails: [],
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
                        contents.after = time_result - 86400; // 현재시간으로 부터 24시간 이전 주문 취합(하루)
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
     
            // console.log(`offset: ${offset}, limit :${limit}`)
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
                    contents.order_ids.push(element.order_id);
                })

                console.log("count", count);
                console.log("count_total", count_total);
                console.log("insertData", insertData.createOrder.length);
                // console.log("orders", response.data.data);
                
                if ( count_total-count !== offset) {
                    offset += limit;
                    getOrder();
                    
                } else {
                    resolve(true);
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
        let order_count = contents.order_ids.length;

        let offset = 0;
        let limit = 100;
        let start = 0;
        let end = start + limit;

        const getOrderDetails = (start, end) => {

            let order_ids = JSON.stringify(contents.order_ids.slice(start, end));
            // console.log(`offset : ${offset}, limit : ${limit}, start : ${start}, end : ${end} `)

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

                console.log("================Response Length===========", response.data.data.length);
                // console.log("================data===========", response.data.data);
                // console.log("================data===========", response.data.data[0].order_items);
                
                response.data.data.forEach(element => {
                    element.order_items.forEach(i => {
                        insertData.createOrderDetails = insertData.createOrderDetails.concat(i);
                    })
                })

                callAPI();

            }).catch((err) => {
                console.log("err", err);
                resolve(false);
            })
        }

        const callAPI = () => {

            offset = limit + offset;
            start = start + limit;
            end = end + limit;

            if ( order_count > offset ) {
                getOrderDetails(start, end)
            } else {
                resolve(true)
            }

        }

        getOrderDetails(start,end);

    });
}

const updateOrder = () => {
    return new Promise((resolve,reject) => {

        let app_key = syncData.app_key;
        let access_token = syncData.access_token;
        let timestamp = new Date().getTime().toString();
        let sign_method = "sha256";
        let created_after = contents.after;
        let created_before = contents.before;
        // let update_after = "2022-08-30T16:00:00+08:00";
        let update_after = contents.after;
        let update_before = contents.before;
        let offset = 0;
        let limit = 100;
    
        // console.log(`update_after ${update_after}, update_before ${update_before}`)

        const getOrder = () => {
     
            // console.log(`offset: ${offset}, limit :${limit}`)
            
            let sign_format = `/orders/getaccess_token${access_token}app_key${app_key}UpdatedAfter${update_after}sign_method${sign_method}timestamp${timestamp}`;
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
                    update_after:update_after,
                }
            }).then((response) => {
            
                // let count = response.data.data.count;
                // let count_total = response.data.data.countTotal;
                // console.log("insertData", insertData.updateOrder.length);
                console.log("response", response.data);
                // console.log("response", response.data.data.orders[10]);

                // insertData.updateOrder = insertData.updateOrder.concat(response.data.data.orders);

                // response.data.data.orders.forEach(element => {
                //     contents.order_ids.push(element.order_id);
                // })

                // console.log("count", count);
                // console.log("count_total", count_total);
                // console.log("orders", response.data.data);
                
                // if ( count_total-count !== offset) {
                //     offset += limit;
                //     getOrder();
                    
                // } else {
                //     resolve();
                // }
                
            }).catch((err) => {
                console.log("err", err);
                resolve(false);
            })
        }
        
        getOrder();
    })
}

const databaseOrderInsert = (order, callback) => {

    // order
    const tomodel_order = {
        voucher_platform: order.voucher_platform,
        voucher: order.voucher,
        warehouse_code: order.warehouse_code,
        order_number: order.order_number,
        voucher_seller: order.voucher_seller,
        created_at: order.created_at,
        voucher_code: order.voucher_code,
        gift_option: order.gift_option,
        shipping_fee_discount_platform: Number(order.shipping_fee_discount_platform),
        customer_last_name: order.customer_last_name,
        promised_shipping_times: order.promised_shipping_times,
        updated_at: order.updated_at,
        price: Number(order.price),
        national_registration_number: order.national_registration_number,
        shipping_fee_original: Number(order.shipping_fee_original),
        payment_method: order.payment_method,
        customer_first_name: order.customer_first_name,
        shipping_fee_discount_seller: order.shipping_fee_discount_seller,
        shipping_fee: Number(order.shipping_fee),
        branch_number: order.branch_number,
        tax_code: order.tax_code,
        items_count: Number(order.items_count),
        delivery_info: order.delivery_info,
        statuses: order.statuses[0],
        address_billing_country: order.address_billing.country,
        address_billing_address3: order.address_billing.address3,
        address_billing_phone: order.address_billing.phone,
        address_billing_address2: order.address_billing.address2,
        address_billing_city: order.address_billing.city,
        address_billing_address1: order.address_billing.address1,
        address_billing_post_code: order.address_billing.post_code,
        address_billing_phone2: order.address_billing.phone2,
        address_billing_last_name: order.address_billing.last_name,
        address_billing_address5: order.address_billing.address5,
        address_billing_address4: order.address_billing.address4,
        address_billing_first_name: order.address_billing.first_name,
        extra_attributes: order.extra_attributes,
        order_id: order.order_id,
        remarks: order.remarks,
        gift_message: order.gift_message,
        address_shipping_country: order.address_shipping.country,
        address_shipping_address3: order.address_shipping.address3,
        address_shipping_phone: order.address_shipping.phone,
        address_shipping_address2: order.address_shipping.address2,
        address_shipping_city: order.address_shipping.city,
        address_shipping_address1: order.address_shipping.address1,
        address_shipping_post_code: order.address_shipping.post_code,
        address_shipping_phone2: order.address_shipping.phone2,
        address_shipping_last_name: order.address_shipping.last_name,
        address_shipping_address5: order.address_shipping.address5,
        address_shipping_address4: order.address_shipping.address4,
        address_shipping_first_name: order.address_shipping.first_name,
        market: contents.country
    }

    execute(`INSERT IGNORE INTO app_lazada_order SET ?`,
    (err,rows)=>{
        if ( err ) {
            throw err;
        } else {
            callback();
        }
    }, tomodel_order);

}

const insertOrder = () => {
    return new Promise((resolve,reject) => {

        let loop = 0;
        const callAPI = () => {
            insertData.createOrder.length == loop ? 
            resolve() :
            databaseOrderInsert(insertData.createOrder[loop++], callAPI);
        }
        databaseOrderInsert(insertData.createOrder[loop++], callAPI)

    })
}

const connectionClose = (callback,bool) => {
    return new Promise((resolve,reject) => {

        console.log(insertData.createOrder.length, insertData.createOrderDetails.length);
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

        // insertData 초기화
        insertData.createOrder = [];
        insertData.createOrderDetails = [];
        insertData.updateOrder = [];
        insertData.updateOrderDetails = [];
        contents.order_ids = [];

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
        let success_details_1 = true;

        if ( insertData.createOrder.length != 0 ) {
            success_details_1 = await createOrderDetails();
        }

        // const success2 = await updateOrder();

        if ( !success1 ) {
            await connectionClose(callback,bool);
            return;
        }

        if ( !success_details_1 ) {
            await connectionClose(callback,bool);
            return;
        }

        console.log("insertData.createOrder",  insertData.createOrder.length);
        console.log("createOrderDetails",  insertData.createOrderDetails.length);
        // console.log("result BBBB",  insertData.createOrderDetails[0]);

        await insertOrder();

        await connectionClose(callback,bool);

    } catch(e){
        console.log(e)
    }
}

module.exports = worker;