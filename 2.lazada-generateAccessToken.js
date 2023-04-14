const crypto = require('crypto');
const axios = require('axios');
require("dotenv").config();

const getAccesstoken = () => {

    const app_key = process.env.APP_KEY;
    const timestamp = new Date().getTime().toString();
    const sign_method = "sha256";
    const code = process.env.CODE;
    const app_secret = process.env.APP_SECRET;
    const path = '/auth/token/create';

    let sign_format = `${path}app_key${app_key}code${code}sign_method${sign_method}timestamp${timestamp}`;
    sign_format = sign_format.toString();

    const sign = crypto.createHmac('sha256', app_secret).update(sign_format).digest('hex').toUpperCase();
    
    return axios({
        method: 'GET',
        url : `https://api.lazada.com.my/rest${path}`,
        params: {
            app_key: app_key,
            timestamp: timestamp,
            sign_method: sign_method,
            sign: sign,
            code :code
        }
    }).then((response) => {
        console.log(response.data)
    }).catch((err) => {
        closing();
        console.log(err)            
    })
}

getAccesstoken();