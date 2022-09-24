const crypto = require('crypto');
const axios = require('axios');

const getProductItem = () => {   

    return new Promise((resolve,reject) => {

        const app_key = "111424";
        const app_secret = "nDF06KuA5wpGuhTqHKePvOUjcVzEHuGa";
        const sign_method = "sha256";
        const access_token = "50000200819dSmgr8JAQvRpcb0HtgpR1f83448bgRvH6DEr7MxxjlDwL0vyiSz9D";
        const timestamp = new Date().getTime().toString();
        const item_id = "1964688313";
        
        let stringformat = `/product/item/getaccess_token${access_token}app_key${app_key}item_id${item_id}sign_method${sign_method}timestamp${timestamp}`;
        stringformat = stringformat.toString();
        
        const sign = crypto.createHmac('sha256', app_secret).update(stringformat).digest('hex').toUpperCase();

        axios({

            method : "GET",
            url : "https://api.lazada.com.my/rest/product/item/get",
            params : {
                access_token : access_token,
                app_key : app_key,
                sign_method : sign_method,
                timestamp : timestamp,
                item_id: item_id,
                sign : sign,
            }
        })
        .then((response)=>{

            console.log("response", response.data);
            
        })
        .catch((err) => {

            console.log("err", err);
        })
    })
}

getProductItem();