const config = require('../config');
const env = require('./env').env;
const pool = require('./connection-pool').createPool(config[env].database);
const error_hook = require('./slack-lazada-order');
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
                error_hook(contents.country,err,(e,res) => {
                    console.log("execute", err);
                    throw err;
                })
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
                        contents.after = new Date(Number((time_result - 86400) + '000')).toISOString(); // 현재 시점에서 24시간 이전 주문부터 취합
                        contents.before = new Date(Number((time_result) + '000')).toISOString();
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
                
                // console.log("======createOrder Response Length===========", response.data.data.orders.length);

                let count = response.data.data.count;
                let count_total = response.data.data.countTotal;

                insertData.createOrder = insertData.createOrder.concat(response.data.data.orders);

                response.data.data.orders.forEach(element => {
                    contents.order_ids.push(element.order_id);
                })

                // console.log("count", count);
                // console.log("count_total", count_total);

                // if ( response.data.data.orders.length > 0) {
                //     response.data.data.orders.map(i => { 
                //         console.log("create_order 수정",i.order_number);
                //         console.log(i.statuses);
                //     });
                // }

                if ( count_total-count !== offset) {
                    offset += limit;
                    getOrder();
                    
                } else {
                    resolve(true);
                }
                
            }).catch((err) => {
                error_hook(contents.country,err,(e,res) => {
                    console.log("createOrder 에러", err);
                    resolve(false);
                });
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

                response.data.data.forEach(element => {
                    element.order_items.forEach(i => {
                        insertData.createOrderDetails = insertData.createOrderDetails.concat(i);
                    })
                })
                
                // console.log("================ createOrderDetails Length===========", insertData.createOrderDetails.length);

                insertData.createOrderDetails.reverse();
                callAPI();

            }).catch((err) => {
                error_hook(contents.country,err,(e,res) => {
                    console.log("createOrderDetails 에러", err);
                    resolve(false);
                });
            })
        }

        const callAPI = () => {

            offset = limit + offset;
            start = start + limit;
            end = end + limit;

            if ( order_count > offset ) {
                getOrderDetails(start, end);
            } else {
                resolve(true);
            }
        }
        getOrderDetails(start,end);
    });
}

const updateOrder = () => {
    return new Promise((resolve,reject) => {

        contents.order_ids = []; // order_ids 초기화
        let app_key = syncData.app_key;
        let access_token = syncData.access_token;
        let timestamp = new Date().getTime().toString();
        let sign_method = "sha256";
        let update_after = contents.after;
        let update_before = contents.before;
        let offset = 0;
        let limit = 100;

        const getOrder = () => {
     
            let sign_format = `/orders/getaccess_token${access_token}app_key${app_key}limit${limit}offset${offset}sign_method${sign_method}timestamp${timestamp}update_after${update_after}update_before${update_before}`;
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
                    update_after: update_after,
                    update_before : update_before,
                    limit:limit,
                    offset:offset,
                }
            }).then((response) => {
                
                // console.log(response.data);
                // console.log("************updateOrder RESPONSE length*******************", response.data.data.orders.length)

                let count = response.data.data.count;
                let count_total = response.data.data.countTotal;
                
                // console.log(`count: ${count}, count_total: ${count_total}`);
                
                insertData.updateOrder = insertData.updateOrder.concat(response.data.data.orders);
                
                response.data.data.orders.forEach(element => {
                    contents.order_ids.push(element.order_id);
                });
                
                // console.log("update count", count);
                // console.log("update count_total", count_total);
                // console.log("updateOrder", insertData.updateOrder.length);
                
                // if ( response.data.data.orders.length > 0) {
                //     response.data.data.orders.map(i => {
                //         console.log("updateOrder 수정",i.order_number);
                //         console.log(i.statuses);
                //     });
                // }

                if ( count_total-count !== offset) {
                    offset += limit;
                    getOrder();
                    
                } else {
                    resolve(true);
                }
                
            }).catch((err) => {
                error_hook(contents.country,err,(e,res) => {
                    console.log("updateOrder 에러", err);
                    resolve(false);
                });
            })
        }
        getOrder();
    })
}

const updateOrderDetails = () => {
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

                // console.log("================Response Length===========", response.data.data.length);
                response.data.data.forEach(element => {
                    element.order_items.forEach(i => {
                        insertData.updateOrderDetails = insertData.updateOrderDetails.concat(i);
                    })
                })

                insertData.updateOrderDetails.reverse();
                // console.log("====updateOrderDetails====", insertData.updateOrderDetails.length);
                callAPI();

            }).catch((err) => {
                error_hook(contents.country,err,(e,res) => {
                    console.log("updateOrderDetails 에러", err);
                    resolve(false);
                });
            })
        }

        const callAPI = () => {

            offset = limit + offset;
            start = start + limit;
            end = end + limit;

            if ( order_count > offset ) {
                getOrderDetails(start, end);
            } else {
                resolve(true);
            }

        }
        getOrderDetails(start,end);

    });
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
        statuses: order.statuses.join(),
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
            error_hook(contents.country,err,(e,res) => {
                console.log("OrderInsert", err)
                throw err;
            });
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

const databaseOrderDetailsInsert = (details, callback) => {

    //order_details
    const tomodel_order_details = {
        tax_amount: details.tax_amount,
        reason: details.reason,
        sla_time_stamp: details.sla_time_stamp,
        voucher_seller: details.voucher_seller,
        purchase_order_id: details.purchase_order_id,
        voucher_code_seller: details.voucher_code_seller,
        voucher_code: details.voucher_code,
        package_id: details.package_id,
        buyer_id: details.buyer_id,
        variation: details.variation,
        voucher_code_platform: details.voucher_code_platform,
        purchase_order_number: details.purchase_order_number,
        sku: details.sku,
        order_type: details.order_type,
        invoice_number: details.invoice_number,
        cancel_return_initiator: details.cancel_return_initiator,
        shop_sku: details.shop_sku,
        is_reroute: details.is_reroute,
        stage_pay_status: details.stage_pay_status,
        sku_id: details.sku_id,
        tracking_code_pre: details.tracking_code_pre,
        order_item_id: details.order_item_id,
        shop_id: details.shop_id,
        order_flag: details.order_flag,
        is_fbl: details.is_fbl,
        name: details.name,
        delivery_option_sof: details.delivery_option_sof,
        order_id: details.order_id,
        status: details.status,
        paid_price: details.paid_price,
        product_main_image: details.product_main_image,
        voucher_platform: details.voucher_platform,
        product_detail_url: details.product_detail_url,
        warehouse_code: details.warehouse_code,
        promised_shipping_time: details.promised_shipping_time,
        shipping_type: details.shipping_type,
        created_at: details.created_at,
        voucher_seller_lpi: details.voucher_seller_lpi,
        shipping_fee_discount_platform: details.shipping_fee_discount_platform,
        wallet_credits: details.wallet_credits,
        updated_at: details.updated_at,
        currency: details.currency,
        shipping_provider_type: details.shipping_provider_type,
        shipping_fee_original: details.shipping_fee_original,
        voucher_platform_lpi: details.voucher_platform_lpi,
        is_digital: details.is_digital,
        item_price: details.item_price,
        shipping_service_cost: details.shipping_service_cost,
        tracking_code: details.tracking_code,
        shipping_fee_discount_seller: details.shipping_fee_discount_seller,
        shipping_amount: details.shipping_amount,
        reason_detail: details.reason_detail,
        return_status: details.return_status,
        shipment_provider: details.shipment_provider,
        voucher_amount: details.voucher_amount,
        digital_delivery_info: details.digital_delivery_info,
        extra_attributes: details.extra_attributes,
        market: contents.country
    }

    execute(`INSERT IGNORE INTO app_lazada_order_details SET ?`,
    (err,rows)=>{
        if ( err ) {
            error_hook(contents.country,err,(e,res) => {
                console.log("OrderDetailsInsert", err)
                throw err;
            });
        } else {
            callback();
        }
    }, tomodel_order_details);

}

const insertOrderDetails = () => {
    return new Promise((resolve,reject) => {

        let loop = 0;
        
        const callAPI = () => {
            insertData.createOrderDetails.length == loop ? 
            resolve() :
            databaseOrderDetailsInsert(insertData.createOrderDetails[loop++], callAPI);
        }
        databaseOrderDetailsInsert(insertData.createOrderDetails[loop++], callAPI)

    })
}

const databaseOrderEdit = (order, callback) => {

    // order
    execute(`INSERT INTO app_lazada_order
    (
        voucher_platform,
        voucher,
        warehouse_code,
        order_number,
        voucher_seller,
        created_at,
        voucher_code,
        gift_option,
        shipping_fee_discount_platform,
        customer_last_name,
        promised_shipping_times,
        updated_at,
        price,
        national_registration_number,
        shipping_fee_original,
        payment_method,
        customer_first_name,
        shipping_fee_discount_seller,
        shipping_fee,
        branch_number,
        tax_code,
        items_count,
        delivery_info,
        statuses,
        address_billing_country,
        address_billing_address3,
        address_billing_phone,
        address_billing_address2,
        address_billing_city,
        address_billing_address1,
        address_billing_post_code,
        address_billing_phone2,
        address_billing_last_name,
        address_billing_address5,
        address_billing_address4,
        address_billing_first_name,
        extra_attributes,
        order_id,
        remarks,
        gift_message,
        address_shipping_country,
        address_shipping_address3,
        address_shipping_phone,
        address_shipping_address2,
        address_shipping_city,
        address_shipping_address1,
        address_shipping_post_code,
        address_shipping_phone2,
        address_shipping_last_name,
        address_shipping_address5,
        address_shipping_address4,
        address_shipping_first_name,
        market
    )
    VALUES
    (
        "${order.voucher_platform}",
        "${order.voucher}",
        "${order.warehouse_code}",
        "${order.order_number}",
        "${order.voucher_seller}",
        "${order.created_at}",
        "${order.voucher_code}",
        "${order.gift_option}",
        ${Number(order.shipping_fee_discount_platform)},
        "${order.customer_last_name}",
        "${order.promised_shipping_times}",
        "${order.updated_at}",
        ${Number(order.price)},
        "${order.national_registration_number}",
        ${Number(order.shipping_fee_original)},
        "${order.payment_method}",
        "${order.customer_first_name}",
        "${order.shipping_fee_discount_seller}",
        ${Number(order.shipping_fee)},
        "${order.branch_number}",
        "${order.tax_code}",
        ${Number(order.items_count)},
        "${order.delivery_info}",
        "${order.statuses.join()}",
        "${order.address_billing.country}",
        "${order.address_billing.address3}",
        "${order.address_billing.phone}",
        "${order.address_billing.address2}",
        "${order.address_billing.city}",
        "${order.address_billing.address1}",
        "${order.address_billing.post_code}",
        "${order.address_billing.phone2}",
        "${order.address_billing.last_name}",
        "${order.address_billing.address5}",
        "${order.address_billing.address4}",
        "${order.address_billing.first_name}",
        "${order.extra_attributes.replace(/"/g, '\\"')}",
        "${order.order_id}",
        "${order.remarks}",
        "${order.gift_message}",
        "${order.address_shipping.country}",
        "${order.address_shipping.address3}",
        "${order.address_shipping.phone}",
        "${order.address_shipping.address2}",
        "${order.address_shipping.city}",
        "${order.address_shipping.address1}",
        "${order.address_shipping.post_code}",
        "${order.address_shipping.phone2}",
        "${order.address_shipping.last_name}",
        "${order.address_shipping.address5}",
        "${order.address_shipping.address4}",
        "${order.address_shipping.first_name}",
        "${contents.country}"
    ) ON DUPLICATE KEY UPDATE
        voucher_platform = "${order.voucher_platform}",
        voucher = "${order.voucher}", 
        warehouse_code = "${order.warehouse_code}", 
        voucher_seller = "${order.voucher_seller}",
        created_at = "${order.created_at}",
        voucher_code = "${order.voucher_code}",
        gift_option = "${order.gift_option}",
        shipping_fee_discount_platform = ${Number(order.shipping_fee_discount_platform)},
        customer_last_name = "${order.customer_last_name}",
        promised_shipping_times = "${order.promised_shipping_times}",
        updated_at = "${order.updated_at}",
        price = ${Number(order.price)},
        national_registration_number = "${order.national_registration_number}",
        shipping_fee_original = ${Number(order.shipping_fee_original)},
        payment_method = "${order.payment_method}", 
        customer_first_name = "${order.customer_first_name}",
        shipping_fee_discount_seller = "${order.shipping_fee_discount_seller}",
        shipping_fee = ${Number(order.shipping_fee)},
        branch_number = "${order.branch_number}",
        tax_code = "${order.tax_code}",
        items_count = ${Number(order.items_count)},
        delivery_info = "${order.delivery_info}",
        statuses = "${order.statuses.join()}",
        address_billing_country = "${order.address_billing.country}",
        address_billing_address3 = "${order.address_billing.address3}",
        address_billing_phone = "${order.address_billing.phone}",
        address_billing_address2 = "${order.address_billing.address2}",
        address_billing_city = "${order.address_billing.city}",
        address_billing_address1 = "${order.address_billing.address1}",
        address_billing_post_code = "${order.address_billing.post_code}",
        address_billing_phone2 = "${order.address_billing.phone2}",
        address_billing_last_name = "${order.address_billing.last_name}",
        address_billing_address5 = "${order.address_billing.address5}",
        address_billing_address4 = "${order.address_billing.address4}",
        address_billing_first_name = "${order.address_billing.first_name}",
        remarks = "${order.remarks}",
        gift_message = "${order.gift_message}",
        address_shipping_country = "${order.address_shipping.country}",
        address_shipping_address3 = "${order.address_shipping.address3}",
        address_shipping_phone = "${order.address_shipping.phone}",
        address_shipping_address2 = "${order.address_shipping.address2}",
        address_shipping_city = "${order.address_shipping.city}",
        address_shipping_address1 = "${order.address_shipping.address1}",
        address_shipping_post_code = "${order.address_shipping.post_code}",
        address_shipping_phone2 = "${order.address_shipping.phone2}",
        address_shipping_last_name = "${order.address_shipping.last_name}",
        address_shipping_address5 = "${order.address_shipping.address5}",
        address_shipping_address4 = "${order.address_shipping.address4}",
        address_shipping_first_name = "${order.address_shipping.first_name}",
        market = "${contents.country}"
    `,

    (err,rows)=>{
        if ( err ) {
            error_hook(contents.country,err,(e,res) => {
                console.log("OrderEditInsert", err)
                throw err;
            });
        } else {
            callback();
        }
    },{});
}

const editOrder = () => {
    return new Promise((resolve,reject) => {

        let loop = 0;
        const callAPI = () => {

            insertData.updateOrder.length == loop ? 
                resolve() :
                databaseOrderEdit(insertData.updateOrder[loop++],callAPI);
        }
        databaseOrderEdit(insertData.updateOrder[loop++],callAPI);
    });
}

const databaseOrderDetailsEdit = (details, callback) => {

    //order Details
    execute(`INSERT INTO app_lazada_order_details
        (
            tax_amount,
            reason,
            sla_time_stamp,
            voucher_seller,
            purchase_order_id,
            voucher_code_seller,
            voucher_code,
            package_id,
            buyer_id,
            variation,
            voucher_code_platform,
            purchase_order_number,
            sku,
            order_type,
            invoice_number,
            cancel_return_initiator,
            shop_sku,
            is_reroute,
            stage_pay_status,
            sku_id,
            tracking_code_pre,
            order_item_id,
            shop_id,
            order_flag,
            is_fbl,
            name,
            delivery_option_sof,
            order_id,
            status,
            paid_price,
            product_main_image,
            voucher_platform,
            product_detail_url,
            warehouse_code,
            promised_shipping_time,
            shipping_type,
            created_at,
            voucher_seller_lpi,
            shipping_fee_discount_platform,
            wallet_credits,
            updated_at,
            currency,
            shipping_provider_type,
            shipping_fee_original,
            voucher_platform_lpi,
            is_digital,
            item_price,
            shipping_service_cost,
            tracking_code,
            shipping_fee_discount_seller,
            shipping_amount,
            reason_detail,
            return_status,
            shipment_provider,
            voucher_amount,
            digital_delivery_info,
            extra_attributes,
            market
        )
        VALUES
        (   
            ${Number(details.tax_amount)},
            "${details.reason}",
            "${details.sla_time_stamp}",
            "${details.voucher_seller}",
            "${details.purchase_order_id}",
            "${details.voucher_code_seller}",
            "${details.voucher_code}",
            "${details.package_id}",
            "${details.buyer_id}",
            "${details.variation}",
            "${details.voucher_code_platform}",
            "${details.purchase_order_number}",
            "${details.sku}",
            "${details.order_type}",
            "${details.invoice_number}",
            "${details.cancel_return_initiator}",
            "${details.shop_sku}",
            "${details.is_reroute}",
            "${details.stage_pay_status}",
            "${details.sku_id}",
            "${details.tracking_code_pre}",
            "${details.order_item_id}",
            "${details.shop_id}",
            "${details.order_flag}",
            "${details.is_fbl}",
            "${details.name}",
            "${details.delivery_option_sof}",
            "${details.order_id}",
            "${details.status}",
            ${Number(details.paid_price)},
            "${details.product_main_image}",
            "${details.voucher_platform}",
            "${details.product_detail_url}",
            "${details.warehouse_code}",
            "${details.promised_shipping_time}",
            "${details.shipping_type}",
            "${details.created_at}",
            "${details.voucher_seller_lpi}",
            "${details.shipping_fee_discount_platform}",
            "${details.wallet_credits}",
            "${details.updated_at}",
            "${details.currency}",
            "${details.shipping_provider_type}",
            "${details.shipping_fee_original}",
            "${details.voucher_platform_lpi}",
            "${details.is_digital}",
            ${Number(details.item_price)},
            ${Number(details.shipping_service_cost)},
            "${details.tracking_code}",
            "${details.shipping_fee_discount_seller}",
            ${Number(details.shipping_amount)},
            "${details.reason_detail}",
            "${details.return_status}",
            "${details.shipment_provider}",
            ${Number(details.voucher_amount)},
            "${details.digital_delivery_info}",
            "${details.extra_attributes}",
            "${contents.country}"
        ) ON DUPLICATE KEY UPDATE
            tax_amount = ${Number(details.tax_amount)},
            reason = "${details.reason}",
            sla_time_stamp = "${details.sla_time_stamp}",
            voucher_seller = "${details.voucher_seller}",
            purchase_order_id = "${details.purchase_order_id}",
            voucher_code_seller = "${details.voucher_code_seller}",
            voucher_code = "${details.voucher_code}",
            package_id = "${details.package_id}",
            buyer_id = "${details.buyer_id}",
            variation = "${details.variation}",
            voucher_code_platform = "${details.voucher_code_platform}",
            purchase_order_number = "${details.purchase_order_number}",
            sku = "${details.sku}",
            order_type = "${details.order_type}",
            invoice_number = "${details.invoice_number}",
            cancel_return_initiator = "${details.cancel_return_initiator}",
            shop_sku = "${details.shop_sku}",
            is_reroute = "${details.is_reroute}",
            stage_pay_status = "${details.stage_pay_status}",
            sku_id = "${details.sku_id}",
            tracking_code_pre = "${details.tracking_code_pre}",
            order_item_id = "${details.order_item_id}",
            shop_id = "${details.shop_id}",
            order_flag = "${details.order_flag}",
            is_fbl = "${details.is_fbl}",
            name = "${details.name}",
            delivery_option_sof = "${details.delivery_option_sof}",
            status = "${details.status}",
            paid_price = ${Number(details.paid_price)},
            product_main_image = "${details.product_main_image}",
            voucher_platform = "${details.voucher_platform}",
            product_detail_url = "${details.product_detail_url}",
            warehouse_code = "${details.warehouse_code}",
            promised_shipping_time = "${details.promised_shipping_time}",
            shipping_type = "${details.shipping_type}",
            created_at = "${details.created_at}",
            voucher_seller_lpi = "${details.voucher_seller_lpi}",
            shipping_fee_discount_platform = "${details.shipping_fee_discount_platform}",
            wallet_credits = "${details.wallet_credits}",
            updated_at = "${details.updated_at}",
            currency = "${details.currency}",
            shipping_provider_type = "${details.shipping_provider_type}",
            shipping_fee_original = "${details.shipping_fee_original}",
            voucher_platform_lpi = "${details.voucher_platform_lpi}",
            is_digital = "${details.is_digital}",
            item_price = ${Number(details.item_price)},
            shipping_service_cost = ${Number(details.shipping_service_cost)},
            tracking_code = "${details.tracking_code}",
            shipping_fee_discount_seller = "${details.shipping_fee_discount_seller}",
            shipping_amount = ${Number(details.shipping_amount)},
            reason_detail = "${details.reason_detail}",
            return_status = "${details.return_status}",
            shipment_provider = "${details.shipment_provider}",
            voucher_amount = ${Number(details.voucher_amount)},
            digital_delivery_info = "${details.digital_delivery_info}",
            extra_attributes = "${details.extra_attributes}",
            market = "${contents.country}"
    `,

    (err,rows)=>{
        if ( err ) {
            error_hook(contents.country,err,(e,res) => {
                console.log("OrderEditDetailsInsert", err)
                throw err;
            });
        } else {
            callback();
        }
    },{});
   
}

const editOrderDetails = () => {
    return new Promise((resolve,reject) => {

        let loop = 0;
        const callAPI = () => {

            insertData.updateOrderDetails.length == loop ? 
                resolve() :
                databaseOrderDetailsEdit(insertData.updateOrderDetails[loop++],callAPI);
        }
        databaseOrderDetailsEdit(insertData.updateOrderDetails[loop++],callAPI);
    });
}

const timeSave = () => {
    return new Promise((resolve,reject) => {

        execute(`INSERT INTO app_lazada_api_history (
                country,
                time_to,
                create_count,
                update_count
                ) VALUES (
                    "${contents.country}",
                    "${contents.before}",
                    ${insertData.createOrder.length},
                    ${insertData.updateOrder.length}
                )`,
                (err,rows)=>{
                    if ( err ) {
                        error_hook(contents.country,err,(e,res) => {
                            console.log("timeSave", err)
                            throw err;
                        });
                    } else {
                        resolve();
                    }
                }, {});
    })
}

const connectionClose = (callback,bool) => {
    return new Promise((resolve,reject) => {

        console.log(insertData.createOrder.length, insertData.createOrderDetails.length, insertData.updateOrder.length, insertData.updateOrderDetails.length);
        console.log(new Date() + ' 종료');
        console.log('=====================================================================');
        console.timeEnd();

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

        const success2 = await updateOrder();
        let success_details_2 = true;

        if ( insertData.updateOrder.length != 0 ) {
            success_details_2 = await updateOrderDetails();
        }

        if ( !success1 ) {
            await connectionClose(callback,bool);
            return;
        }

        if ( !success_details_1 ) {
            await connectionClose(callback,bool);
            return;
        }

        if ( !success2 ) {
            await connectionClose(callback,bool);
            return;
        }

        if ( !success_details_2 ) {
            await connectionClose(callback,bool);
            return;
        }
     
        insertData.createOrder.length !=0 && await insertOrder();
        insertData.createOrderDetails.length !=0 && await insertOrderDetails();
        insertData.updateOrder.length !=0 && await editOrder();
        insertData.updateOrderDetails.length !=0 && await editOrderDetails();

        await timeSave();
        await connectionClose(callback,bool);

    } catch(e){
        console.log(e)
    }
}

module.exports = worker;

