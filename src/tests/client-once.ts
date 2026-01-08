import { Client } from "../client";

const client = new Client({
	// address: "donutsmp.net",
	// address: "127.0.0.1",
	address: "geo.hivebedrock.network",
});

client.on("unconnectedPong", (packet) => {
	console.log(packet);
});

const time = Date.now();
client.connect().then(() => {
	console.log(`Time taked ${Date.now() - time}ms`);
});
