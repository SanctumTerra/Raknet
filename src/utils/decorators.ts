import type { Socket } from "node:dgram";
import type { Client } from "../client/client";
import { Logger } from "./Logger";

interface HasDebugOptions {
	options: {
		debug: boolean;
	};
}

interface InternalSocket extends Socket {
	_handle?: {
		setSocketPriority?: (priority: number) => void;
	};
}

export function measureExecutionTime(
	_target: object,
	propertyKey: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value;

	descriptor.value = async function (
		this: HasDebugOptions,
		...args: unknown[]
	) {
		const start = performance.now();
		const result = await originalMethod.apply(this, args);
		const end = performance.now();
		const duration = end - start;

		if (this.options?.debug) {
			console.log(`${propertyKey} execution time: ${duration.toFixed(2)}ms`);
		}

		return result;
	};

	return descriptor;
}

export function optimizeConnection(
	_target: object,
	_propertyKey: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value;

	descriptor.value = async function (this: Client, ...args: unknown[]) {
		if (this.socket) {
			try {
				if (process.platform === "linux") {
					const LINUX_BUFFER_SIZE = 262144;
					this.socket.setRecvBufferSize(LINUX_BUFFER_SIZE);
					this.socket.setSendBufferSize(LINUX_BUFFER_SIZE);

					const internalSocket = this.socket as InternalSocket;
					if (internalSocket._handle?.setSocketPriority) {
						internalSocket._handle.setSocketPriority(6);
					}
				} else {
					const bufferSize =
						this.options.mtuSize * this.options.socketBufferMultiplier;
					this.socket.setRecvBufferSize(bufferSize);
					this.socket.setSendBufferSize(bufferSize);
				}

				this.socket.setTTL(64);

				const recvSize = this.socket.getRecvBufferSize();
				const sendSize = this.socket.getSendBufferSize();

				if (this.options.debug) {
					Logger.debug(`Socket buffers: recv=${recvSize}, send=${sendSize}`);
				}
			} catch (error) {
				if (this.options.debug) {
					Logger.debug("Socket optimization failed:", error as Error);
				}
			}
		}

		const originalTimeout = this.options.timeout;
		try {
			this.options.timeout = Math.min(
				originalTimeout,
				this.options.initialConnectionTimeout,
			);
			return await originalMethod.apply(this, args);
		} finally {
			this.options.timeout = originalTimeout;
		}
	};

	return descriptor;
}
