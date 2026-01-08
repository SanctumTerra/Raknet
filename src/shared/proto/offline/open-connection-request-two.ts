import { BinaryStream, Int64, Uint8, Bool } from "@serenityjs/binarystream";
import { Packets } from "../enums";
import { Address, Magic } from "../types";

export class OpenConnectionRequestTwo extends BinaryStream {
	public address!: Address;
	public mtu!: number;
	public guid!: bigint;
	public cookie!: number | null;
	public clientSupportsecurity!: boolean;

	public serialize(): Buffer {
		Uint8.write(this, Packets.OpenConnectionRequest2);
		Magic.write(this);
		if (this.cookie != null) {
			this.writeUint32(this.cookie);
			// client_supports_security should be false if we don't support libcat encryption
			Bool.write(this, this.clientSupportsecurity ?? false);
		}
		Address.write(this, this.address);
		this.writeUint16(this.mtu);
		Int64.write(this, this.guid);
		return this.getBuffer();
	}

	public deserialize(): OpenConnectionRequestTwo {
		Uint8.read(this);
		Magic.read(this);
		// Check if there's enough data for cookie + clientSupportsecurity before address
		// Cookie format: cookie (4) + clientSupportsecurity (1) = 5 bytes minimum before address
		// We need to peek ahead to determine if security data is present
		// For now, assume no security on deserialize (server-side typically doesn't need this)
		this.cookie = null;
		this.clientSupportsecurity = false;
		this.address = Address.read(this);
		this.mtu = this.readUint16();
		this.guid = Int64.read(this);
		return this;
	}
}
