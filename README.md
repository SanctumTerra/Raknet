# RakNet Library

This is a library for the RakNet protocol.

## Installation

```bash
npm install @sanctumterra/raknet
```


## Examples

### Server

```ts
import { Server } from "./src/index";

const server = new Server({
    host: "0.0.0.0",
    port: 19132,
});

server.on("connect", (connection) => {
    console.log(`New connection from ${connection.remoteInfo.address}`);
    connection.on("encapsulated", (buffer) => {
        console.log(`Received encapsulated data from ${connection.remoteInfo.address}`);
        console.log(buffer);
    });
});
server.start();
```

### Client

```ts
	const client = new Client({
		address: "127.0.0.1",
		port: 19132,
		mtuSize: 1492,
		debug: false,
	});
	client.connect().then((ad) => {
		if(ad) console.log(ad);
	});
```