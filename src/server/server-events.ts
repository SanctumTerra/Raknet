import type { Connection } from "./connection";

type ServerEvents = {
	close: [];
	connect: [connection: Connection];
	encapsulated: [frameset: Buffer, connection: Connection];
	closeConnection: [connection: Connection];
};

export type { ServerEvents };
