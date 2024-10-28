import "reflect-metadata";
import { Client } from "../client/client";

const client = new Client({ address: "127.0.0.1", port: 19133, protocolVersion: 11, debug: true });

client.on("connect", () => {
    console.log("Connected to server");
})
client.connect().then((advertisement) => {
    console.log(advertisement);
}).catch((err) => {
    console.error(err);
});