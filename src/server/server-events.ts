import type { Connection } from "./connection";

type ServerEvents = {
	close: [];
	connect: [connection: Connection];
};

export type { ServerEvents };
