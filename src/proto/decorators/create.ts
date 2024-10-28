import type { BasePacket, DataType } from "../packets";
import {
	type Endianness,
	Uint16,
	Uint32,
	Uint8,
} from "@serenityjs/binarystream";
import type { ValidTypes } from "../types";
/**
 * Thanks to SerenityJS as an example.
 * @param id 
 * @returns 
 */
export function Create(id: number) {
	return (target: typeof BasePacket) => {
		target.id = id;

		const packetData: Array<{
			name: string;
			type: ValidTypes;
			endian: Endianness;
			parameter: unknown;
		}> = Reflect.getOwnMetadata("properties", target.prototype);
		const properties = Reflect.getMetadata("properties", target) || [];

		if (!properties.includes("serialize")) {
			target.prototype.serialize = function () {
				this.clear();
				if (id < 1) throw new Error("Packet ID cannot be less than 1.");
				if (id <= 255) this.writeUint8(id);
				else if (id <= 65535) this.writeUint16(id);
				else if (id <= 4294967295) this.writeUint32(id);
				else throw new Error("Packet ID cannot be greater than 4294967295.");
				if (!packetData) return this.getBuffer();
				for (const { name, type, endian, parameter } of packetData) {
					if (parameter) {
						const value = this[parameter as keyof BasePacket];
						const dtype = type as typeof DataType;
						const data = (this as never)[name];
						dtype.write(this, data, endian as Endianness, value);
					} else {
						const dtype = type as typeof DataType;
						const data = (this as never)[name];
						dtype.write(this, data, endian as Endianness);
					}
				}
				return Buffer.from(this.binary);
			};
		}

		if (!properties.includes("deserialize")) {
			target.prototype.deserialize = function () {
				if (this.binary.length === 0) return this;
				if (id <= 255) target.id = this.readUint8();
				else if (id <= 65535) target.id = this.readUint16();
				else if (id <= 4294967295) target.id = this.readUint32();
				else throw new Error("Invalid packet ID range");

				if (!packetData) return this;

				for (const { name, type, endian, parameter } of packetData) {
					if (parameter) {
						const value = this[parameter as keyof BasePacket];
						const dtype = type as typeof DataType;
						const data = (this as never)[name];
						(this[name as keyof BasePacket] as unknown) = dtype.read(
							this,
							endian as Endianness,
							value,
						);
					} else {
						const dtype = type as typeof DataType;
						const data = (this as never)[name];
						(this[name as keyof BasePacket] as unknown) = dtype.read(
							this,
							endian as Endianness,
						);
					}
				}
				return this;
			};
		}
		if (!properties.includes("getId")) {
			target.prototype.getId = () => target.id;
		}
	};
}
