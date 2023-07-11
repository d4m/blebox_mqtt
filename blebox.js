const axios = require('axios');
const EventEmitter = require('events');
const convert = require('color-convert');
const assert = require('assert');
const invert = require('invert-kv');

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
                        case 'wLightBox':
                            device = new wLightBox(data, this.interval);    
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

class wLightBox extends EventEmitter {

    constructor(data, interval) {
        super();

        let device = data.device;

        this.interval = interval;
        this.name = device.deviceName;
        this.type = device.type;
        this.fv = device.fv;
        this.hv = device.hv;
        this.id = device.id;
        this.ip = device.ip;

        this.is_rgb = data.rgbw.colorMode < 3;
        this.is_white = data.rgbw.colorMode == 1;

        this.effects = {
            'Brak': 0,
            'Ściemnianie': 1,
            'RGB': 2,
            'Policja': 3,
            'Stroboskop': 4,
        };

        this.rgbw = null;
        this.avail = null;
        this.state = {
            brightness: 0,
            color: {
                r: 0,
                g: 0,
                b: 0,
            },
            effect: 'Brak',
            state: 'OFF',
            white_value: 0,
        };
    }

    init() {
        this.refresh().then(() => {
            setInterval(() => this.refresh(), this.interval*1000);
        });
    }

    update(rgbw, avail) {

        if(avail != this.avail)
        {
            this.avail = avail;
            this.emit('avail', avail);
        }

        let state_changed = false;

        try {
            assert.deepEqual(rgbw, this.rgbw);
        } catch(e) {
            state_changed = true;
        }

        if(!state_changed)
            return;

        if(rgbw.desiredColor == '00000000')
            this.state.state = 'OFF';
        else
        {
            let hsv = convert.hex.hsv(rgbw.desiredColor);
            let rgb = convert.hex.rgb(rgbw.desiredColor);
            let brightness = parseInt((hsv[2]*255)/100);
            let white;

            if(!this.is_white)
                white = 0;
            else
                white = parseInt(rgbw.desiredColor.substr(-2), 16);            
    
            this.state = {
                brightness: brightness,
                color: {
                    r: rgb[0],
                    g: rgb[1],
                    b: rgb[2],
                },
                effect: invert(this.effects)[rgbw.effectID] || 'Brak',
                state: 'ON',
                white_value: white,
            };
        }

        this.rgbw = rgbw;
        this.emit('state', this.state);
    }

    refresh() {
        return new Promise((resolve, reject) => {

            this.request('/api/rgbw/state').then(response => {
                this.update(response.rgbw, true);
                resolve(response.rgbw);
            }).catch(error => {
                this.update(this.rgbw, false);
                resolve(this.rgbw);
            });
        });
    }

    setState(state) {
        let brightness = state.brightness !== undefined ? state.brightness : this.state.brightness;
        let white = state.white_value !== undefined ? state.white_value : this.state.white_value;
        let color = state.color || this.state.color;
        let effectID = state.effect !== undefined ? this.effects[state.effect] : this.state.effectID;
        let hex;

        if(state.state == 'OFF')
        {
            hex = '00000000';
            effectID = 0;
        }
        else
        {
            let hsv = convert.rgb.hsv([color.r, color.g, color.b]);
            let rgb = convert.hsv.rgb([hsv[0], hsv[1], (brightness/255)*100]);
            hex = convert.rgb.hex(rgb);
            hex += white.toString(16).padStart(2, '0').toUpperCase();
        }

        let rgbw = {
            desiredColor: hex,
            effectID: effectID,
        };

        return new Promise((resolve, reject) => {
            this.request('/api/rgbw/set', {
                rgbw: rgbw
            }).then((response) => {
                this.update(response.rgbw, this.avail);
                resolve(response);
            }).catch((error) => reject(error));
        });
    }

    request(path, data) {
        return new Promise((resolve, reject) => {
            request(this.ip, path, data)
                .then((response) => resolve(response))
                .catch((error) => reject(error));
        })
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
                .catch((error) => reject(error));
        })
    }
}

class switchBoxD extends switchBoxBase {

    update() {
        return new Promise((resolve, reject) => {
            let url = parseInt(this.apiLevel) >= 20190808 ? '/api/relay/extended/state' : '/api/relay/state';

            this.request(url).then((response) => {
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
        this.relays[0].name = this.name;

        return new Promise((resolve, reject) => {
            this.request('/api/relay/state').then((response) => {
                this.relays[0].update(response[0].state, true);
                resolve(this.relays);
            }).catch((error) => {
                this.relays[0].update(this.relays[0].state, false);
                resolve(this.relays);
            });
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
