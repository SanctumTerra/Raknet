import { BasePacket } from "./base-packet";
import { Create, Serialize } from "../decorators";
import { Packet } from "../enums";
import { Endianness, Uint24 } from "@serenityjs/binarystream";
import { Frame } from "./types";

/**
 * https://wiki.vg/Raknet_Protocol#Frame_Set_Packet
 */
@Create(Packet.FrameSet)
export class Frameset extends BasePacket {
	/** Uint25 Little Endian */
	@Serialize(Uint24, Endianness.Little) public sequence!: number;
	@Serialize(Frame) public frames!: Array<Frame>;
}
