import "reflect-metadata";
import { Client } from "./client";
export * from "./client";
export * from "./proto";

const client = new Client({
	address: "127.0.0.1",
	port: 19132,
	mtuSize: 1492,
});

console.time("connect");
client.connect().then((ad) => {
	console.timeEnd("connect");
	console.log(ad);
});
