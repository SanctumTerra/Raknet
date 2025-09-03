import type { Connection } from "../connection";

export interface RaknetServerEvents {
	listening: undefined;
	connect: Connection;
	disconnect: Connection;
}
