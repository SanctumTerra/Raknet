import { Client } from "../client";

const client = new Client({
	address: "donutsmp.net",
	// address: "127.0.0.1",
	// address: "geo.hivebedrock.network",
	proxy: {
		host: "216.185.39.231",
		port: 45849,
		userId: "CV8GK4TW",
		password: "I2F91P8H",
	},
});

client.on("unconnectedPong", (packet) => {
	console.log(packet);
});

const time = Date.now();
client.connect().then(() => {
	console.log(`Time taked ${Date.now() - time}ms`);
});
