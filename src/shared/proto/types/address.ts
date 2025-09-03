import type { RemoteInfo } from "node:dgram";
import type { BinaryStream } from "@serenityjs/binarystream";

export class Address {
	public address: string;
	public port: number;
	public version: number;

	public constructor(address: string, port: number, version: number) {
		this.address = address;
		this.port = port;
		this.version = version;
	}

	public static fromIdentifier(identifier: RemoteInfo): Address {
		return new Address(
			identifier.address,
			identifier.port,
			identifier.family === "IPv4" ? 4 : 6,
		);
	}

	static write(stream: BinaryStream, address: Address): void {
		stream.writeUint8(address.version);
		if (address.version === 4) {
			const addressBits = address.address.split(".", 4);
			for (const bit of addressBits) {
				stream.writeUint8(Number.parseInt(bit, 10) ^ 0xff);
			}
			stream.writeUint16(address.port);
		} else {
			stream.writeUint16(23);
			stream.writeUint16(address.port);
			stream.writeUint32(0);
			const addressParts = address.address.split(":");
			for (const part of addressParts) {
				const num = Number.parseInt(part, 16);
				stream.writeUint16(num ^ 0xffff);
			}
			stream.writeUint32(0);
		}
	}

	public static read(stream: BinaryStream): Address {
		const version = stream.readUint8();
		if (version === 4) {
			const bytes = stream.read(4);
			const address = bytes.map((byte) => byte ^ 0xff).join(".");
			const port = stream.readUint16();
			return new Address(address, port, version);
		}
		if (version === 6) {
			stream.offset += 2;
			const port = stream.readUint16();
			stream.offset += 4;
			const addressParts = [];
			for (let i = 0; i < 8; i++) {
				const part = stream.readUint16() ^ 0xffff;
				addressParts.push(part.toString(16).padStart(4, "0"));
			}
			const address = addressParts.join(":");
			stream.offset += 4;
			return new Address(address, port, version);
		}
		return new Address("0.0.0.0", 0, 0);
	}
}
