import { Client } from "../client/client";

const client = new Client({
	debug: false,
	host: "127.0.0.1",
	port: 19133,
});

client.connect().then((advertisement) => {
	console.log(advertisement);
	console.log(`Connected to ${client.options.host}:${client.options.port}`);
});
