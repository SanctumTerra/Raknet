import { Client } from "../client";

const client = new Client();

client.on("unconnectedPong", (packet) => {
	console.log(packet);
});

const time = Date.now();
client.connect().then(() => {
	console.log(`Time taked ${Date.now() - time}ms`);
});
