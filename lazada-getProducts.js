const crypto = require('crypto');
const axios = require('axios');

const getProducts = () => {   

    return new Promise((resolve,reject) => {

        const app_key = "111424";
        const app_secret = "nDF06KuA5wpGuhTqHKePvOUjcVzEHuGa";
        const sign_method = "sha256";
        const access_token = "50000200819dSmgr8JAQvRpcb0HtgpR1f83448bgRvH6DEr7MxxjlDwL0vyiSz9D";
        const timestamp = new Date().getTime().toString();
        const limit = 50;
        const offset = 0;

        let stringformat = `/products/getaccess_token${access_token}app_key${app_key}limit${limit}offset${offset}sign_method${sign_method}timestamp${timestamp}`;
        stringformat = stringformat.toString();
        
        const sign = crypto.createHmac('sha256', app_secret).update(stringformat).digest('hex').toUpperCase();

        axios({

            method : "GET",
            url : "https://api.lazada.com.my/rest/products/get",
            params : {
                access_token : access_token,
                app_key : app_key,
                sign_method : sign_method,
                timestamp : timestamp,
                limit : limit,
                offset : offset,
                sign : sign
            }
        })
        .then((response)=>{

            console.log("response", response.data);
            console.log("response", response.data.data.products[0]);
            
        })
        .catch((err) => {

            console.log("err", err);
        })
    })
}

getProducts();