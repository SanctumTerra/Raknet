import { RakNetClient } from "../client/raknet-client";

// Create a new RakNetClient instance
const client = new RakNetClient(11, true);

// Server connection details
const serverAddress = "127.0.0.1"
const serverPort = 19133;

// Attempt to connect to the server
client.connect(serverAddress, serverPort)
  .then(() => {
    console.log(`Connected to ${serverAddress}:${serverPort}`);
  })
  .catch((error) => {
    console.error(`Failed to connect: ${error.message}`);
  });
