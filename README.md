# Raknet Client

### Installation

```bash
npm install @sanctumterra/raknet
bun install @sanctumterra/raknet
```

### Usage

```ts
import { Client } from "@sanctumterra/raknet";

const client = new Client({
  host: "127.0.0.1",
  port: 19132
});

client.connect().then((advertisement) => {
	console.log(advertisement);
	console.log(`Connected to ${client.options.host}:${client.options.port}`);
	client.disconnect(); // We can disconnect after we're connected if you want to close the connection
});

```
