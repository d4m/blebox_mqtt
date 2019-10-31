let mqtt = require('mqtt');

class Mqtt {
    constructor(options) {
        this.client = null;
        this.host = options.host;
        this.port = options.port;
        this.username = options.username;
        this.password = options.password;

        this.connect();
    }

    connect() {
        this.client = mqtt.connect(`mqtt://${this.host}:${this.port}`, {
            username: this.username,
            password: this.password
        });
    }

    publish(topic, message, options, callback) {

        if(typeof message == 'object')
            message = JSON.stringify(message);

        this.client.publish(topic, message, options, callback);
    }

    on(event, callback) {
        this.client.on(event, callback);
    }
}

module.exports = Mqtt;
