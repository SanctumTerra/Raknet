import type { Connection } from "../connection";

export interface DisconnectEvent {
	connection: Connection;
	reason: string;
}

export interface RaknetServerEvents {
	listening: undefined;
	connect: Connection;
	disconnect: DisconnectEvent;
}
