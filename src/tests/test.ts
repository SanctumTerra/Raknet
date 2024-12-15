import "reflect-metadata";
import { Client } from "../client/client";
import { Logger } from "../utils";

const client = new Client({
	address: "hivebedrock.network",
	port: 19132,
	protocolVersion: 11,
	debug: false,
});

client.on("connect", () => {
	console.log("Connected to server");
});
console.time("connect");
client
	.connect()
	.then((advertisement) => {
		console.log(advertisement);
		console.timeEnd("connect");
	})
	.catch((err) => {
		console.error(err);
	});

let startMemory: NodeJS.MemoryUsage;
let startTime: string;

setInterval(() => {
	console.clear();
	if (!startMemory) {
		startMemory = process.memoryUsage();
		startTime = new Date().toLocaleString();
	}
	const currentMemory = process.memoryUsage();

	Logger._log(`
		§e${startTime}§r
		§aHeap Used: ${formatMemory(currentMemory.heapUsed)} (Δ ${formatMemoryDiff(currentMemory.heapUsed, startMemory.heapUsed)})§r
		§7External: ${formatMemory(currentMemory.external)} (Δ ${formatMemoryDiff(currentMemory.external, startMemory.external)})§r
		§7ArrayBuffers: ${formatMemory(currentMemory.arrayBuffers)} (Δ ${formatMemoryDiff(currentMemory.arrayBuffers, startMemory.arrayBuffers)})§r
		§7Total Heap: ${formatMemory(currentMemory.heapTotal)} (Δ ${formatMemoryDiff(currentMemory.heapTotal, startMemory.heapTotal)})§r
	`);
}, 250);

function formatMemory(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatMemoryDiff(current: number, start: number): string {
	const diff = current - start;
	const sign = diff >= 0 ? "+" : "";
	return `${sign}${(diff / 1024 / 1024).toFixed(2)} MB`;
}
