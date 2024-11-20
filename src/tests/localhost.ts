import "reflect-metadata";
import { Client } from "../client";

const client = new Client({
	address: "127.0.0.1",
	port: 19132,
	mtuSize: 1492,
	debug: true,
});

client.connect().then((ad) => {
	console.log(ad);
});
