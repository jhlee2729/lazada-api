//암호화, 복호화
const aes256 = require('aes256');
let key = 'Test'; //config로

const encrypt = (text) => {

    let result = aes256.encrypt(key, text);
    return result;
}

const decrypt = (text) => {

    let result = aes256.decrypt(key, text);
    return result;
}

module.exports = { encrypt, decrypt };