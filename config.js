const yaml = require('js-yaml');
const merge = require('defaults-deep');
const fs   = require('fs');
const log = require('./log')(['error']);
const args = process.argv.slice(2);

const file = args.pop() || './configuration.yaml';

try {
    const config_file = yaml.safeLoad(fs.readFileSync(file, 'utf8'));
    let config_default = {
        mqtt: {
            broker: '127.0.0.1',
            port: 1883,
            username: null,
            password: null,
            discovery: true,
            discovery_prefix: 'homeassistant',
        },
        blebox: []
    };

    if(config_file.http !== undefined)
    {
        config_default.http = {
            bind: '0.0.0.0',
            port: 3000,
        };
    }

    if(config_file.log !== undefined)
        config_default.log = ['error', 'mqtt', 'http', 'blebox'];
    else
        config_default.log = [];

    let config = merge(config_file, config_default);

    module.exports = config;

} catch(error) {
    if(error.errno == -2)
        log('error', 'Config file parsing error.', `File ${file} not found.`);
    else
        log('error', error.message);

    process.exit(0);
}


