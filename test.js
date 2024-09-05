const { RakNetClient } = require("./dist/index.cjs");

const client = new RakNetClient(11, true);

client.connect("127.0.0.1", 19133);

client.on("encapsulated", () => {});