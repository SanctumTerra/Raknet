import { BinaryStream } from "@serenityjs/binarystream";
import { Packets } from "../enums";

export class DisconnectMessage extends BinaryStream {
	public serialize(): Buffer {
		this.writeUint8(Packets.Disconnect);
		return this.getBuffer();
	}

	public deserialize(buffer: Buffer): DisconnectMessage {
		return this;
	}
}
