import type { Ack, Frame, FrameSet } from "@serenityjs/raknet";
import type {
	OpenConnectionFirstReply,
	OpenConnectionSecondReply,
	UnconnectedPong,
} from "../packets";

interface ClientEvents {
	tick: [];
	close: [];
	error: [error: Error];
	"unconnected-pong": [UnconnectedPong];
	"open-connection-first-reply": [OpenConnectionFirstReply];
	"open-connection-second-reply": [OpenConnectionSecondReply];
	frameset: [FrameSet];
	encapsulated: [Frame];
	connect: [];
	ack: [Ack];
}

export type { ClientEvents };
