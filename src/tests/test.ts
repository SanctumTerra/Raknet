import "reflect-metadata";
import { Client } from "../client/client";

const client = new Client({ address: "hivebedrock.network", port: 19132, protocolVersion: 11, debug: true });

client.on("connect", () => {
    console.log("Connected to server");
});
console.time("connect");
client.connect().then((advertisement) => {
    console.log(advertisement);
    console.timeEnd("connect");
}).catch((err) => {
    console.error(err);
});