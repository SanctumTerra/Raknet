import type {
	Ack,
	ConnectedPing,
	ConnectionRequest,
	NewIncomingConnection,
	OpenConnectionReplyOne,
	OpenConnectionReplyTwo,
	OpenConnectionRequestOne,
	OpenConnectionRequestTwo,
	UnconnectedPing,
	UnconnectedPong,
	Frameset,
	Nack,
	ConnectedPong,
	ConnectionRequestAccepted,
} from "../proto";

export interface ClientEvents {
	"open-connection-reply-one": [OpenConnectionReplyOne];
	"open-connection-reply-two": [OpenConnectionReplyTwo];
	"open-connection-request-one": [OpenConnectionRequestOne];
	"open-connection-request-two": [OpenConnectionRequestTwo];
	"unconnected-ping": [UnconnectedPing];
	"unconnected-pong": [UnconnectedPong];
	frameset: [Frameset];
	"connected-ping": [ConnectedPing];
	"connection-request": [ConnectionRequest];
	"new-incoming-connection": [NewIncomingConnection];
	"connection-request-accepted": [ConnectionRequestAccepted];
	"connected-pong": [ConnectedPong];
	encapsulated: [Buffer];
	ack: [Ack];
	nack: [Nack];
	error: [Error];
	close: [];
	connect: [];
	tick: [];
}
