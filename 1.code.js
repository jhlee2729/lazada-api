const crypto = require('crypto');
require("dotenv").config();

const getCodeURL = () => {

    const url = `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=${process.env.REDIRECT_URI}&client_id=${process.env.APP_KEY}`
    return url;
}

console.log(getCodeURL());