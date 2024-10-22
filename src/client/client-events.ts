import type { Ack, Frame, FrameSet } from "@serenityjs/raknet";
import type {
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	UnconnectedPong,
} from "../packets";

interface ClientEvents {
	tick: [];
	close: [];
	error: [error: Error];
	"unconnected-pong": [UnconnectedPong];
	"open-connection-reply-one": [OpenConnectionReplyOne];
	"open-connection-reply-two": [OpenConnectionReplyTwo];
	frameset: [FrameSet];
	encapsulated: [Frame];
	connect: [];
	ack: [Ack];
}

export type { ClientEvents };
