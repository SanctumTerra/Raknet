import { Create } from "../decorators";
import { Packet } from "../enums";
import { BasePacket } from "./base-packet";

@Create(Packet.DisconnectionNotification)
class DisconnectionNotification extends BasePacket {}

export default DisconnectionNotification;
