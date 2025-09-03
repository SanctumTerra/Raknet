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

function fromString(message: string): Advertisement {
	const parts = message.split(";");
	if (parts.length < 9) {
		throw new Error(
			`Invalid advertisement string: expected >=9 fields, got ${parts.length}`,
		);
	}
	const [
		type,
		motd,
		protocol,
		version,
		players,
		maxPlayers,
		guid,
		gamemode,
		serverName,
	] = parts;
	return {
		type: type as AdvertisementType,
		serverName,
		protocol: Number.parseInt(protocol, 10),
		version,
		playerCount: Number.parseInt(players, 10),
		maxPlayers: Number.parseInt(maxPlayers, 10),
		guid: BigInt(guid),
		message: motd,
		gamemode,
	};
}

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
