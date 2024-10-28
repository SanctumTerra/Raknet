import "reflect-metadata";
import { Client } from "../client/client";

const client = new Client({ address: "zeqa.net", port: 19132, protocolVersion: 11, debug: true });
client.connect().then((advertisement) => {
    console.log(advertisement);
}).catch((err) => {
    console.error(err);
});