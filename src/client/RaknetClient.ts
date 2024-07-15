import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import { Address, Packet, Status, UnconnectedPong } from '@serenityjs/raknet';
import { BinaryStream } from '@serenityjs/binarystream';
import { PacketHandler } from './PacketHandler';
import { Queue } from './Queue';
import { Logger } from '../utils/Logger';

type MCV = 'MCPE' | 'MCEE';

interface Advertisement {
	type: MCV;
	message: string;
	protocol: number;
	version: string;
	playerCount: number;
	maxPlayers: number;
	serverGUID: number;
	serverName: string;
	gameMode: string;
}

class RakNetClient extends EventEmitter {
  public socket: dgram.Socket;
  public serverAddress: string;
  public serverPort: number;
  public connected: boolean = false;
  public protocol: number = 11;
  public id: bigint;
  private packetHandler: PacketHandler;
  private isBusy: boolean = false;
  public queue: Queue;
  
  public status: Status;
  public static debug = false;

  public clientAdress: Address = new Address('0.0.0.0', 0, 4);

  constructor(serverAddress: string, serverPort: number) {
    super();
    this.serverAddress = serverAddress;
    this.serverPort = serverPort;
    this.socket = dgram.createSocket('udp4');
    this.connected = false;
    this.id = BigInt(Array.from({ length: 20 }, () => Math.floor(Math.random() * 10)).join(''));
	this.status = Status.Connecting;
    this.packetHandler = new PacketHandler(this);
	this.queue = new Queue(this);
    setInterval(() => {
		this.emit("tick");
	}, 50);
  }

  async connect(callback?: (ping: Advertisement) => void) {
    Logger.info('RakNet client connecting to ' + this.serverAddress + ' on port ' + this.serverPort);
	const ping = await this.ping();
	if(callback) callback(ping)
	await this.socket.on('message', (msg) => { this.packetHandler.handleIncoming(msg) });
    await this.packetHandler.sendConnectionPacket();
  }

  close() {
    this.socket.close();
  }

  public async ping(): Promise<Advertisement>{
    return new Promise((resolve, reject) => {
		  const timeout = setTimeout(() => {
				this.socket.removeListener('message', messageHandler);
				this.isBusy = false;
				reject(new Error('Timeout waiting for UnconnectedPong'));
			}, 5000);
			const messageHandler = (msg: Buffer) => {
				const stream = BinaryStream.fromBuffer(msg);
				const packetId = stream.readUint8();
				if (packetId === Packet.UnconnectedPong) {
					const pongPacket = new UnconnectedPong(msg);
					pongPacket.deserialize();
					const advertisementData = pongPacket.message.split(';').slice(0, 9);
					const advertisement: Advertisement = {
						type: advertisementData[0] as MCV,
						message: advertisementData[1],
						protocol: parseInt(advertisementData[2]),
						version: advertisementData[3],
						playerCount: parseInt(advertisementData[4]),
						maxPlayers: parseInt(advertisementData[5]),
						serverGUID: parseInt(advertisementData[6]),
						serverName: advertisementData[7],
						gameMode: advertisementData[8]
					};

					clearTimeout(timeout);
					this.socket.removeListener('message', messageHandler);
					this.isBusy = false;
					resolve(advertisement);
				}
			};
			this.socket.on('message', messageHandler);
			this.packetHandler.sendUnconnectedPing();
      });
  }

  public getFrameHandler() {
    return this.packetHandler.framehandler;
  }

  send(packet: Buffer) {
    this.socket.send(packet, 0, packet.length, this.serverPort, this.serverAddress, (err) => {
      if (err) {
        console.error('Error sending packet:', err);
      }
    });
  }
}


export {Advertisement, RakNetClient}