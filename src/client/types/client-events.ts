import type { UnconnectedPong } from "../../shared";

export interface ClientEvents {
	unconnectedPong: UnconnectedPong;
	error: Error;
	connect: undefined;
	encapsulated: Buffer;
}
