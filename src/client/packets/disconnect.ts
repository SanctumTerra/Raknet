import { BasePacket, Packet, Proto } from "@serenityjs/raknet";

@Proto(Packet.Disconnect)
class Disconnect extends BasePacket {}

export { Disconnect };