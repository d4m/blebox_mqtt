# Wrapper MQTT dla urządzeń BleBox napisany w Node.js

#### Obsługiwane urządzenia:
- switchBox
- switchBoxD
- wLightBox

#### Funkcjonalności:
- Intergracja MQTT z Home Assistantem (MQTT Discovery - automatyczne dodawanie encji w HA).
- Serwer HTTP (Domyślny port: 3000) dla akcji przychodzących z urządzeń switchBox.<br>
Jeśli na urządzeniu ustawimy na wejściu wywołanie URL np.: ```http://XXX.XXX.XXX.XXX:3000/binary_sensor/Włącz+pasek+LED```zostanie utworzona encja typu binary_sensor o nazwie ```Włącz pasek LED```, a jej stan będzie się zmieniał po wywołaniu akcji.

#### Budowanie obrazu Dockera:
```
$ docker build https://github.com/d4m/blebox_mqtt.git -t d4m/blebox_mqtt
```

#### Uruchomienie kontenera:
```
$ docker run --name blebox_mqtt -v blebox_mqtt_config:/config -e TZ="Europe/Warsaw" -p 3000:3000 -d d4m/blebox_mqtt
```
