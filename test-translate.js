const result = require('dotenv').config();
console.log('dotenv result:', result);
console.log('TRANSLATE_PROVIDER:', process.env.TRANSLATE_PROVIDER);
console.log('PORT:', process.env.PORT);