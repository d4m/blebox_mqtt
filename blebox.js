const axios = require('axios');
const EventEmitter = require('events');

let request = (host, path, data, method) => {
    method = !method && data ? 'post' : 'get';

    return new Promise((resolve, reject) => {

        let options = {
            method: method,
            url: `http://${host}${path}`,
            responseType: 'json',
        };

        if(method == 'post')
            options.data = data;
        else
            options.params = data;

        axios(options)
            .then((response) => resolve(response.data))
            .catch((error) => reject(error));
    });
}

class Blebox extends EventEmitter {
    constructor(options) {
        super();

        this.host = options.host;
        this.interval = options.interval

        this.init();
    }

    init() {
        let init = new Promise((resolve, reject) => {

            request(this.host, '/api/device/state').then((data) => {

                if(!data.device.ip)
                {
                    setTimeout(() => {
                        reject({host: this.host});
                    }, 5000)
                }
                else
                {
                    let device;

                    switch(data.device.type) {
                        case 'switchBox':
                            device = new switchBox(data.device, this.interval);
                            break;
                        case 'switchBoxD':
                            device = new switchBoxD(data.device, this.interval);    
                            break;
                        default:
                            device = null;
                    }

                    if(device)
                        resolve(device);
                }
            }).catch((error) => {
                reject({host: this.host});
            });
        });

        init.then(device => {
            device.init();
            this.emit(device.type, device);
        }).catch(error => {
            this.emit('connectionError', {
                host: error.host,
            });

            this.init();
        });
    }
}

class switchBoxRelay extends EventEmitter {
    constructor(id, device) {
        super();

        this.device = device;
        this.initialized = false;
        this.stop_update = false;
        this.id = id;
        this.name = null;
        this.avail = null;
        this.state = null;
    }

    init() {
        this.emit('init', this);
        this.emit('avail', this);
        this.emit('state', this);

        this.initialized = true;
    }

    update(state, avail) {

        if(!this.initialized)
        {
            this.avail = avail;
            this.state = state;

            return this.init();
        }

        if(this.stop_update)
            return;

        if(avail != this.avail)
        {
            this.avail = avail;
            this.emit('avail', this);
        }

        if(state != this.state)
        {
            this.state = state;
            this.emit('state', this);
        }
    }

    setState(state) {
        this.stop_update = true;

        this.device.setState(this.id, state)
            .then((response) => {
                this.stop_update = false;
                this.update(state, this.avail);
            }).catch((error) => this.stop_update = false);
    }
}

class switchBoxBase extends EventEmitter {

    constructor(device, interval) {
        super();

        this.interval = interval;
        this.name = device.deviceName;
        this.type = device.type;
        this.fv = device.fv;
        this.hv = device.hv;
        this.apiLevel = device.apiLevel;
        this.id = device.id;
        this.ip = device.ip;
        this.relays = [];
    }

    init() {
        this.setRelays().then((relays) => {
            this.emit('ready', relays);

            this.update().then(() => {
                setInterval(() => this.update(), this.interval*1000);
            });
        });
    }

    request(path, data) {
        return new Promise((resolve, reject) => {
            request(this.ip, path, data)
                .then((response) => resolve(response))
                .catch((error) => resolve(error));
        })
    }
}

class switchBoxD extends switchBoxBase {

    update() {
        return new Promise((resolve, reject) => {
            this.request('/api/relay/state').then((response) => {
                this.relays[0].name = response.relays[0].name;
                this.relays[1].name = response.relays[1].name;
    
                this.relays[0].update(response.relays[0].state, true);
                this.relays[1].update(response.relays[1].state, true);
                
                resolve(this.relays);
            }).catch((error) => {
                this.relays[0].update(this.relays[0].state, false);
                this.relays[1].update(this.relays[1].state, false);

                resolve(this.relays);
            });
        });
    }

    setRelays() {
        this.relays.push(new switchBoxRelay(0, this));
        this.relays.push(new switchBoxRelay(1, this));       

        return new Promise((resolve, reject) => resolve(this.relays));
    }

    setState(id, state) {
        return new Promise((resolve, reject) => {
            this.request('/api/relay/set', {
                relays: [{
                    relay: id,
                    state: state ? 1 : 0,
                }]
            }).then((response) => resolve(response))
              .catch((error) => reject(error));
        });
    }
}

class switchBox extends switchBoxBase {

    update() {
        this.relays[0].name = this.device.deviceName;

        this.request('/api/relay/state').then((response) => {
            this.relays[0].update(response.relays[0].state, true);
        }).catch((error) => {
            this.relays[0].update(this.relays[0].state, false);
        });
    }

    setRelays() {
        this.relays.push(new switchBoxRelay(0, this));

        return new Promise((resolve, reject) => resolve(this.relays));
    }

    setState(id, state) {
        return new Promise((resolve, reject) => {
            this.request('/api/relay/set', [{
                    relay: id,
                    state: state ? 1 : 0,
                }]
            ).then((response) => resolve(response))
             .catch((error) => reject(error));
        });
    }
}

module.exports = Blebox;
