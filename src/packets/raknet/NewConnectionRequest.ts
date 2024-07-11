import { Bool } from "@serenityjs/binarystream";
import { ConnectionRequest } from "@serenityjs/raknet"
import { Serialize } from "../serialize";

/**
 * Represents an connection request packet.
 */
class NewConnectionRequest extends ConnectionRequest {
   @Serialize(Bool) public security!: boolean;
}
export { NewConnectionRequest };