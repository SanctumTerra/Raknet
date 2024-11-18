import "reflect-metadata";
import { Client } from "../client";

const client = new Client({
	address: "127.0.0.1",
	port: 19132,
	mtuSize: 1492,
});

client.connect().then((ad) => {
	console.log(ad);
});
