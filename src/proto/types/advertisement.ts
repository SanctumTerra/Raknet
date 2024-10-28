type AdvertisementType = "MCPE" | "MCEE";

interface Advertisement {
	type: AdvertisementType;
	message: string;
	protocol: number;
	version: string;
	playerCount: number;
	maxPlayers: number;
	serverGUID: number;
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
		servername,
		gamemode,
	] = message.split(";");
	return {
		type: type as AdvertisementType,
		message: motd,
		protocol: Number.parseInt(protocol),
		version,
		playerCount: Number.parseInt(players),
		maxPlayers: Number.parseInt(maxPlayers),
		serverGUID: Number.parseInt(guid),
		serverName: servername,
		gamemode: gamemode,
	};
}

export { type Advertisement, fromString };
