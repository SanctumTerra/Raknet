import { Client } from "../client";
import { Logger } from "../shared/logger";

/**
 * Run a connection-time benchmark by performing a number of Client connection attempts.
 *
 * Performs `iterations` sequential connection attempts, measures the time from initiating
 * Client.connect() to the Client's "connect" event for each attempt, logs each measurement,
 * and logs the list of times and their average at the end.
 *
 * If a connect event never occurs for an attempt, that iteration will await indefinitely.
 *
 * @param iterations - Number of sequential connection attempts to perform (should be a positive integer)
 */
async function runBenchmark(iterations: number): Promise<void> {
	Logger.info(
		`§bStarting connection benchmark for ${iterations} iterations...§r`,
	);
	const connectionTimes: number[] = [];

	for (let i = 0; i < iterations; i++) {
		const time: number = Date.now();

		const client = new Client({});
		client.on("unconnectedPong", (packet) => {
			Logger.debug("unconnectedPong packet:", packet);
		});
		const connectionPromise: Promise<number> = new Promise((resolve) => {
			client.on("connect", () => {
				const time2: number = Date.now();
				const timeDiff: number = time2 - time;
				Logger.info(
					`§aConnection attempt ${i + 1}/${iterations}: Connected in ${timeDiff}ms§r`,
				);
				resolve(timeDiff);
			});
		});

		client.connect();

		const connectionTime: number = await connectionPromise;
		connectionTimes.push(connectionTime);
	}

	Logger.warn("\n§e--- Benchmark Results ---§r");
	Logger.info("All Connection Times:", connectionTimes);

	const totalTime: number = connectionTimes.reduce(
		(sum, time) => sum + time,
		0,
	);
	const averageTime: number = totalTime / iterations;
	Logger.info(
		`Average connection time over ${iterations} attempts: §d${averageTime.toFixed(2)}ms§r`,
	);
}

runBenchmark(10);
