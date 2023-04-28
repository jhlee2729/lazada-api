const crypto = require('crypto');
const axios = require('axios');
require("dotenv").config();

const getProductItem = () => {

    const app_key = process.env.APP_KEY;
    const app_secret = process.env.APP_SECRET;
    const sign_method = "sha256";
    const access_token = process.env.ACCESS_TOKEN;
    const timestamp = new Date().getTime().toString();
    const item_id = process.env.ITEM_ID;

    let stringformat = `/product/item/getaccess_token${access_token}app_key${app_key}item_id${item_id}sign_method${sign_method}timestamp${timestamp}`;
    stringformat = stringformat.toString();

    const sign = crypto.createHmac('sha256', app_secret).update(stringformat).digest('hex').toUpperCase();
    return axios({
        method: "GET",
        url: "https://api.lazada.com.my/rest/product/item/get",
        params: {
            access_token: access_token,
            app_key: app_key,
            sign_method: sign_method,
            timestamp: timestamp,
            item_id: item_id,
            sign: sign,
        }
    })
        .then((response) => {
            console.log("response", response.data);

        })
        .catch((err) => {
            console.log("err", err);
        })
}

getProductItem();