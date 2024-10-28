import { BinaryStream } from "@serenityjs/binarystream";

export class BasePacket extends BinaryStream {
	/**
	 * The Identifier of the packet.
	 */
	public static id: number;

	/**
	 * @returns The ID of the packet.
	 */
	public getId(): number {
		throw new Error("BasePacket.getId() is not implemented!");
	}

	/**
	 * Serializes the packet.
	 * @returns {Buffer}
	 */
	public serialize(): Buffer {
		throw new Error("BasePacket.serialize() is not implemented!");
	}

	/**
	 * Deserializes the packet.
	 * @returns {this}
	 */
	public deserialize(): this {
		throw new Error("BasePacket.deserialize() is not implemented!");
	}

	/**
	 * Clears the packet.
	 */
	public clear(): void {
		this.binary = [];
	}
}
