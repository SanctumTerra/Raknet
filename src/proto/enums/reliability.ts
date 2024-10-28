export enum Reliability {
	Unreliable = 0x00,
	UnreliableSequenced = 0x01,
	Reliable = 0x02,
	ReliableOrdered = 0x03,
	ReliableSequenced = 0x04,
	UnreliableWithAckReceipt = 0x05,
	ReliableWithAckReceipt = 0x06,
	ReliableOrderedWithAckReceipt = 0x07,
}
