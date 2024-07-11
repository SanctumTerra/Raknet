import { RakNetClient } from "../src/client/RaknetClient";

const client = new RakNetClient("127.0.0.1", 19132);
(async() => {
    await client.connect(() => {
        console.log("Received Response")
    })
})();