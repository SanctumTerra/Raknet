import "reflect-metadata";
import { Server } from "../server/server";
import { Logger } from "../utils";
import type { Connection } from "../index";

Logger.disabled = false;
Logger.debugEnabled = false;

const server = new Server({
	port: 19132,
	host: "0.0.0.0",
});

server.start();

server.on("connect", (connection: Connection) => {
	Logger.info(
		`Connection from ${connection.remoteInfo.address}:${connection.remoteInfo.port} established in ${connection.getConnectionTime()}ms`,
	);
	connection.on("encapsulated", (packet: Buffer) => {
		Logger.info(`Received Encapsulated packet: ${packet.toString("hex")}`);
	});
});


let closingState = false;
let attempt = 0;
process.on("SIGINT", () => {
	if (!closingState) {
		closingState = true;
		server.close();
	}
	attempt++;
	// We may be desperate here
	if (attempt > 10) {
		process.exit(0);
	}
	return false;
});
