type AdvertisementType = "MCPE" | "MCEE";

interface Advertisement {
	type: AdvertisementType;
	message: string;
	protocol: number;
	version: string;
	playerCount: number;
	maxPlayers: number;
	guid: bigint;
	serverName: string;
	gamemode: string;
}

/**
 * Parses a semicolon-delimited advertisement string into an Advertisement object.
 *
 * The input must contain nine semicolon-separated fields in this order:
 * `type;motd;protocol;version;players;maxPlayers;guid;serverName;gamemode`.
 *
 * @param message - The raw advertisement string in the format above.
 * @returns The parsed Advertisement with `guid` converted to `bigint` and numeric fields parsed.
 */
function fromString(message: string): Advertisement {
	const [
		type,
		motd,
		protocol,
		version,
		players,
		maxPlayers,
		guid,
		serverName,
		gamemode,
	] = message.split(";");
	return {
		type: type as AdvertisementType,
		serverName,
		protocol: Number.parseInt(protocol),
		version,
		playerCount: Number.parseInt(players),
		maxPlayers: Number.parseInt(maxPlayers),
		guid: BigInt(guid),
		message: motd,
		gamemode,
	};
}

/**
 * Serialize an Advertisement into the semicolon-delimited wire format.
 *
 * The output is a single string with fields in this exact order:
 * `type;message;protocol;version;playerCount;maxPlayers;guid;gamemode;serverName`.
 * The `guid` bigint is converted to a JavaScript number representation before serialization.
 *
 * @param advertisement - Advertisement object to serialize
 * @returns The advertisement encoded as a semicolon-delimited string
 */
function AdvertisementToString(advertisement: Advertisement): string {
	return [
		advertisement.type,
		advertisement.message,
		advertisement.protocol,
		advertisement.version,
		advertisement.playerCount,
		advertisement.maxPlayers,
		Number(advertisement.guid),
		advertisement.gamemode,
		advertisement.serverName,
	].join(";");
}

export { type Advertisement, fromString, AdvertisementToString };
