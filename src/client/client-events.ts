import type {
	Ack,
	Advertisement,
	ConnectedPing,
	ConnectedPong,
	ConnectionRequest,
	ConnectionRequestAccepted,
	NewIncomingConnection,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	OpenConnectionRequestTwo,
	UnconnectedPing,
	UnconnectedPong,
} from "../proto";
import type { Frameset } from "../proto/packets/frameset";

export interface ClientEvents {
	"open-connection-reply-one": [OpenConnectionReplyOne];
	"open-connection-reply-two": [OpenConnectionReplyTwo];
	"open-connection-request-one": [OpenConnectionRequestOne];
	"open-connection-request-two": [OpenConnectionRequestTwo];
	"unconnected-ping": [UnconnectedPing];
	"unconnected-pong": [UnconnectedPong];
	frameset: [Frameset];
	"connected-ping": [ConnectedPing];
	"connected-pong": [ConnectedPong];
	"connection-request": [ConnectionRequest];
	"connection-request-accepted": [ConnectionRequestAccepted];
	"new-incoming-connection": [NewIncomingConnection];
	encapsulated: [Buffer];
	ack: [Ack];
	error: [Error];
	close: [];
	connect: [Advertisement];
	tick: [];
}
