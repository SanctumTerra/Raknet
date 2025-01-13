import "reflect-metadata";
import { Client } from "../client";

const clients: Client[] = [];

if (process.argv[2] === "server") {
	setInterval(() => {
		const client = new Client({
			address: "127.0.0.1",
			port: 19132,
			mtuSize: 1492,
			debug: false,
		});
		clients.push(client);
		console.time(`Connection ${clients.length}`);
		client.connect().then((ad) => {
			console.log(ad);
			console.timeEnd(`Connection ${clients.length}`);
		});
	}, 4);
} else {
	const client = new Client({
		address: "127.0.0.1",
		port: 19132,
		mtuSize: 1492,
		debug: false,
	});
	console.time("Connection");
	client.connect().then((ad) => {
		console.log(ad);
		console.timeEnd("Connection");
	});
}
