FROM node:12

RUN mkdir -p /config
WORKDIR /usr/src/blebox_mqtt

COPY package*.json ./
COPY configuration.yaml /config/

#RUN npm install
RUN npm ci --only=production

COPY . .

EXPOSE 3000
VOLUME /config
CMD [ "node", "server.js", "/config/configuration.yaml" ]
