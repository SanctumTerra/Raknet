const { RakNetClient } = require("../index");

const client = new RakNetClient("127.0.0.1", 19132);

(async () => {
    console.log(await client.ping());
})();
 