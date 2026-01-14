import type { UnconnectedPong } from "../../shared";

export interface ClientEvents {
	unconnectedPong: UnconnectedPong;
	error: Error;
	connect: undefined;
	disconnect: string; // reason for disconnect
	encapsulated: Buffer;
}
