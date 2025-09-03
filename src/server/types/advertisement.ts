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
