type VersionType = 'MCPE' | 'MCEE';

interface Advertisement {
	type: VersionType;
	message: string;
	protocol: number;
	version: string;
	playerCount: number;
	maxPlayers: number;
	serverGUID: number;
	serverName: string;
	gameMode: string;
}

export { VersionType, Advertisement };