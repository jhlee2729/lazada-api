const crypto = require('crypto');
const axios = require('axios');

// 해당 url 가서 code 발급 후 -> access_token, refresh_token을 넣어준다
let auth = 'https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=https://www.naver.com&client_id=111402&country=cb'

// 라자다 아이템
// app_key = 111402, app_secret = DCzoT6z91X6ps4vsFJ4VOjIuG2Ly7A5F
// 라자다 주문
// app_key = 111424, app_secret = nDF06KuA5wpGuhTqHKePvOUjcVzEHuGa

//M1 access_token 발급 : app_key, code, app_secret 확인
const access_token = () => {
    return new Promise((resolve,reject) => {

        let app_key = "111402";
        let timestamp = new Date().getTime().toString();
        let sign_method = "sha256";
        let code = "0_111402_sy2tLWOwFgDRrOghquZFzigP41949";
        let app_secret = "DCzoT6z91X6ps4vsFJ4VOjIuG2Ly7A5F";

        let sign_format = `/auth/token/createapp_key${app_key}code${code}sign_method${sign_method}timestamp${timestamp}`;
        sign_format = sign_format.toString();

        const sign = crypto.createHmac('sha256', app_secret).update(sign_format).digest('hex').toUpperCase();

        console.log("sign", sign)

        axios({
            method: 'GET',
            url : 'https://api.lazada.com.my/rest/auth/token/create',
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
    })
}

access_token();