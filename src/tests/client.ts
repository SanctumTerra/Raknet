import "reflect-metadata";
import { Client } from "../client";

console.time("connect");
const client = new Client({
	address: "127.0.0.1",
	port: 19132,
	protocolVersion: 11,
	debug: false,
});
client.connect().then(() => {
	console.timeEnd("connect");
	client.disconnect();
});
