const http = require('express')();
const utf8 = require('utf8');
const merge = require('defaults-deep');
const config = require('./config');
const log = require('./log')(config.log);
const Mqtt = require('./mqtt.js');
const Blebox = require('./blebox.js');

let devicesInitialized = false;
let bleboxRelays = {}, bleboxLights = {}, bleboxInputs = {};

const mqtt = new Mqtt({
    host: config.mqtt.broker,
    port: config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password,
});

if(config.http)
{
    http.listen(config.http.port, config.http.bind, () => {
        log('http', `Server listen on ${config.http.bind}:${config.http.port}`);
    }).on('error', error => {
        let message = error.message;

        if(error.errno == 'EADDRINUSE')
            message = `Address ${config.http.bind}:${config.http.port} alredy in use.`

        log('error', 'HTTP Server error.', message);
        process.exit(0);
    });

    http.get('/binary_sensor/:name', (req, res) => {
        let ip = req.ip.split(':').pop();
        let name = req.params.name;
        name = decodeURIComponent(name.replace(/\+/g, '%20'));
        name = utf8.decode(name);

        findInput(ip, name).then((button) => {
            button.pressed();
            res.send(`Action ${name} called`);
            log('http', `Action "${name}" called from "${ip}"`);
        }).catch(error => {
            log('http', `Unknown action "${name}" called from ${ip}`);
            res.status(404).send(error);
        });
    });
}

mqtt.on('connect', () => {
    log('mqtt', `Connected to ${mqtt.host}:${mqtt.port}`);
    devicesInit();
});

mqtt.client.subscribe('blebox/#', (err, granted) => {

    if(err) {
        log('mqtt', `Subscribe error. ${err}`);
        return;
    }

    log('mqtt', `Subscribed to ${granted.map(g => `"${g.topic}"`).join(', ')}`);
});

mqtt.on('close', () => {
    log('mqtt', `Disconnected from ${mqtt.host}:${mqtt.port}`);
});

mqtt.on('error', (err) => {
    log('mqtt', 'Error', err);
    mqtt.client.end();
});

mqtt.client.on('message', (topic, message) => {

    let [type, entity_id, action] = topic.split('/').slice(-3);

    if(action != 'command')
        return;

    message = String(message);

    try {
        if(type == 'light' && bleboxRelays[entity_id] !== undefined && bleboxRelays[entity_id].switchbox.component == 'light')
            type = 'switch';

        if(type == 'switch')
        {
            let relay = bleboxRelays[entity_id].relay;
            relay.setState(message == 'ON' ? true : false);
        }
        if(type == 'light')
        {
            let light = bleboxLights[entity_id];
            light.setState(JSON.parse(message));
        }
        else
            return;
    } catch(e) {
        return;
    }

    log('mqtt', 'Message received', topic, message);
});

class Hass {
    constructor() {
        this.manufacturer = 'BleBox';
    }

    sendDiscovery() {
        this.setDiscovery();

        mqtt.publish(this.discovery_topic, this.discovery_message, {retain: true});
        log('mqtt', 'Send Discovery', this.discovery_message);
    }

    sendState(state) {
        mqtt.publish(this.state_topic, state, {retain: true});
        this.sendStateLog(state);
    }

    sendStateLog(state) {
        log('blebox', `${this.device.type} "${this.name}" changed state to ${state}`);
        log('mqtt', 'Send State', this.state_topic, `'${state}'`);
    }

    sendAvail(avail) {
        mqtt.publish(this.availability_topic, avail, {retain: true});
        this.sendAvailLog(avail);
    }

    sendAvailLog(avail) {
        log('blebox', `${this.device.type} "${this.name}" changed status to ${avail}`);
        log('mqtt', 'Send Status', this.state_topic, `'${avail}'`);
    }
}

class HassSensor extends Hass {
    constructor(switchbox, input, device) {
        super();

        this.input = input;
        this.switchbox = switchbox;
        this.device = device;

        this.setName();
        this.setUniqueId();
        this.setTopics();

        if(config.mqtt.discovery && switchbox.discovery)
            this.sendDiscovery();

        this.device.relays[0].on('avail', (relay) => {
            let avail = relay.avail ? 'online' : 'offline';
            this.sendAvail(avail);
        });

        this.sendState('OFF');
    }

    pressed() {
        this.sendState('ON');
        setTimeout(() => this.sendState('OFF'), 2000);
    }

    setUniqueId() {
        this.unique_id = `${this.device.type}_${this.device.id}_${this.input.input_id}_${this.input.action_id}`;
    }

    setName() {
        this.name = `${this.device.name} - ${this.input.name}`;
    }

    setTopics() {
        this.discovery_topic = `${config.mqtt.discovery_prefix}/binary_sensor/${this.unique_id}/config`;
        this.state_topic = `blebox/binary_sensor/${this.unique_id}/state`;
        this.availability_topic = `blebox/binary_sensor/${this.unique_id}/status`;
    }

    setDiscovery(){
        this.discovery_message = {
            name: this.name,
            state_topic: this.state_topic,
            availability_topic: this.availability_topic,
            unique_id: this.unique_id,
            device: {
                identifiers: `${this.device.type}_${this.device.id}`,
                model: this.device.type,
                sw_version: this.device.fv,
                name: this.device.name,
                manufacturer: this.manufacturer,
            },
        };
    }
}

class HassSwitch extends Hass {

    constructor(switchbox, relay) {
        super();

        this.relay = relay;
        this.switchbox = switchbox;
        this.device = relay.device;

        this.setName();
        this.setUniqueId();
        this.setTopics();

        if(config.mqtt.discovery && switchbox.discovery)
            this.sendDiscovery();

        this.relay.on('state', (relay) => {
            let state = relay.state ? 'ON' : 'OFF';
            this.sendState(state);            
        });

        this.relay.on('avail', (relay) => {
            let avail = relay.avail ? 'online' : 'offline';
            this.sendAvail(avail);
        });
    }

    setUniqueId() {
        this.unique_id = `${this.device.type}_${this.device.id}`;

        if(this.device.type == 'switchBoxD')
            this.unique_id += `_${this.relay.id}`;
    }

    setName() {
        if(this.device.type == 'switchBoxD')
            this.name = `${this.device.name} - ${this.relay.name}`;
        else
            this.name = this.relay.name;
    }

    setTopics() {
        this.discovery_topic = `${config.mqtt.discovery_prefix}/${this.switchbox.component}/${this.unique_id}/config`;
        this.state_topic = `blebox/${this.switchbox.component}/${this.unique_id}/state`;
        this.availability_topic = `blebox/${this.switchbox.component}/${this.unique_id}/status`;
        this.command_topic = `blebox/${this.switchbox.component}/${this.unique_id}/command`;
    }

    setDiscovery(){
        this.discovery_message = {
            name: this.name,
            state_topic: this.state_topic,
            availability_topic: this.availability_topic,
            command_topic: this.command_topic,
            unique_id: this.unique_id,
            device: {
                identifiers: `${this.device.type}_${this.device.id}`,
                model: this.device.type,
                sw_version: this.device.fv,
                name: this.device.name,
                manufacturer: this.manufacturer,
            },
        };
    }
}

class HassLight extends Hass {

    constructor(switchbox, device) {
        super();

        this.switchbox = switchbox;
        this.device = device;

        this.setName();
        this.setUniqueId();
        this.setTopics();

        if(config.mqtt.discovery && switchbox.discovery)
            this.sendDiscovery();

        device.on('state', (state) => {
            this.sendState(state);
        });

        device.on('avail', (avail) => {
            avail = avail ? 'online' : 'offline';
            this.sendAvail(avail);
        });
    }

    sendStateLog(state) {
        log('blebox', `${this.device.type} "${this.name}" changed state`);
        log('mqtt', 'Send State', this.state_topic, state);
    }

    setState(state) {
        this.device.setState(state);
    }

    setUniqueId() {
        this.unique_id = `${this.device.type}_${this.device.id}`;
    }

    setName() {
        this.name = this.device.name;
    }

    setTopics() {
        this.discovery_topic = `${config.mqtt.discovery_prefix}/light/${this.unique_id}/config`;
        this.state_topic = `blebox/light/${this.unique_id}/state`;
        this.command_topic = `blebox/light/${this.unique_id}/command`;
        this.availability_topic = `blebox/light/${this.unique_id}/status`;
    }

    setDiscovery(){
        this.discovery_message = {
            name: this.name,
            schema: 'json',
            brightness: true,
            rgb: this.device.is_rgb,
            white_value: this.device.is_white,
            effect: this.device.effects ? true : false,
            unique_id: this.unique_id,
            state_topic: this.state_topic,
            command_topic: this.command_topic,
            availability_topic: this.availability_topic,
            device: {
                identifiers: `${this.device.type}_${this.device.id}`,
                model: this.device.type,
                sw_version: this.device.fv,
                name: this.device.name,
                manufacturer: this.manufacturer,
            },
        };

        if(this.device.effects)
        {
            this.discovery_message.effect_list = Object.keys(this.device.effects);
        }
    }
}

let devicesInit = () => {

    if(devicesInitialized)
        return;

    config.blebox.forEach(blebox_config => {

        let blebox = new Blebox({
            host: blebox_config.ip,
            interval: blebox_config.interval || 5,
        });

        blebox.on('switchBox', device => onSwitchBox(blebox_config, device));
        blebox.on('switchBoxD', device => onSwitchBox(blebox_config, device));
        blebox.on('wLightBox', device => onWlightBox(blebox_config, device));

        blebox.on('connectionError', error => {
            log('blebox', `Could not connect to host ${error.host}. Retrying...`);
        });
    });

    devicesInitialized = true;
}


let onWlightBox = (switchbox, device) => {

    switchbox = merge(switchbox, {
        discovery: true,
        inputs: true,
    });

    log('blebox', `New device added from ${device.ip}. ${device.type} "${device.name}"`);

    let hassLight = new HassLight(switchbox, device);
    bleboxLights[hassLight.unique_id] = hassLight;
}

let onSwitchBox = (switchbox, device) => {

    switchbox = merge(switchbox, {
        component: 'switch',
        discovery: true,
        inputs: true,
    });

    if(!['switch', 'light'].includes(switchbox.component))
        switchbox.component = 'switch';

    device.on('ready', (relays) => {
        log('blebox', `New device added from ${device.ip}. ${device.type} "${device.name}"`);

        if(switchbox.inputs)  
        {
            if(bleboxInputs[device.ip] == undefined)
                bleboxInputs[device.ip] = {};
    
            getBinarySensors(device).then(inputs => {
                inputs.forEach(input => {
                    bleboxInputs[device.ip][input.name] = new HassSensor(switchbox, input, device);
                });
            });
        }

        relays.forEach((relay) => {
            relay.on('init', (relay) => {
                let hassSwitch = new HassSwitch(switchbox, relay)
                bleboxRelays[hassSwitch.unique_id] = hassSwitch;
            });
        });
    });
}

let getBinarySensors = (device) => {

    return new Promise((resolve, reject) => {
        device.request('/api/input/state').then((response) => {

            let inputs = [response.inputs[0].actions, []];

            if(device.type == 'switchBoxD')
                inputs[1] = response.inputs[1].actions;

            inputs = inputs.map((inputs, input_id) => {

                return inputs.map(action => {

                        if(action.actionType == 50 && action.param.split('/').slice(-2).shift() == 'binary_sensor') {
                            let name = action.param.split('/').slice(-2).pop();
                            name = decodeURIComponent(name.replace(/\+/g, '%20'));
                            return {
                                action_id: action.id,
                                input_id: input_id,
                                name: name
                            };
                        }

                        return null;
                }).filter(action => action !== null);
            }).filter(inputs => inputs !== []);

            resolve(inputs[0].concat(inputs[1]));

        }).catch((error) => reject(error));
    });
}

let findInput = (ip, name) => {
    return new Promise((resolve, reject) => {
        try {
            resolve(bleboxInputs[ip][name]);
        } catch(e) {
            reject(`Action "${name}" not found`);
        }
    });
}
