import { BinaryStream, Bool, Endianness, Int64, Uint8 } from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Magic } from "../types";

export class OpenConnectionReplyOne extends BinaryStream {
	public guid!: bigint;
	public security!: boolean;
	public hasCookie!: boolean;
	public cookie!: number | null;
	public serverPublicKey!: Buffer | null;
	public mtu!: number;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionReply1);
		Magic.write(this);
		Int64.write(this, this.guid);
		Bool.write(this, this.security);
		if (this.security && this.cookie != null) {
			this.writeUint32(this.cookie);
		}
		this.writeUint16(this.mtu);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionReplyOne {
		Uint8.read(this);
		Magic.read(this);
		this.guid = this.readInt64(Endianness.Little)
		this.security = Bool.read(this);
		this.cookie = null;
		this.hasCookie = false;
		this.serverPublicKey = null;

		if (this.security) {
			const remaining = this.buffer.byteLength - this.offset;
			// Full security format: has_cookie (1) + cookie (4) + public_key (294) + mtu (2) = 301
			if (remaining >= 1 + 4 + 294 + 2) {
				this.hasCookie = Bool.read(this);
				this.cookie = this.readUint32();
				this.serverPublicKey = this.read(294);
			} else if (remaining >= 4 + 2) {
				// Simple security format: cookie (4) + mtu (2)
				this.cookie = this.readUint32();
			}
		}

		this.mtu = this.readUint16();
		return this;
	}
}
