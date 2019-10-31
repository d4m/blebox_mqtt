const moment = require('moment');

module.exports = (config) => {
    return (module, ...message) => {
        if(!config.includes(module))
            return;
    
        let date = moment().format('YYYY-MM-DD HH:mm:ss');
        let _message = `${date} | ${module.toUpperCase()} =>`;
    
        console.log(_message, ...message);
    }
}