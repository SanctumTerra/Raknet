import {
	NetworkSession,
	FrameSet,
	Frame,
	Reliability,
	Logger,
} from "../shared";

// Enable debug logging to see the reordering in action
Logger.debugEnabled = true;

// Create a test network session``
const session = new NetworkSession(1400);
session.send = (data: Buffer) => {
	console.log(`Would send ${data.length} bytes`);
};
session.handle = (data: Buffer) => {
	console.log(`✓ Processed frame: "${data.toString()}"`);
};

// Create test frame sets with out-of-order sequences
function createTestFrameSet(
	sequence: number,
	orderedIndex: number,
	message: string,
): FrameSet {
	const frameSet = new FrameSet();
	frameSet.sequence = sequence;

	const frame = new Frame();
	frame.reliability = Reliability.ReliableOrdered;
	frame.orderChannel = 0;
	frame.orderedFrameIndex = orderedIndex; // Set the ordered index
	frame.reliableFrameIndex = sequence; // Set reliable index
	frame.payload = Buffer.from(message);

	frameSet.frames = [frame];
	return frameSet;
}

console.log("Testing frame reordering system...\n");

// Simulate receiving frames out of order (starting from 0)
const frames = [
	createTestFrameSet(0, 0, "First frame"),
	createTestFrameSet(2, 2, "Third frame (out of order)"),
	createTestFrameSet(1, 1, "Second frame (fills gap)"),
	createTestFrameSet(4, 4, "Fifth frame (way ahead)"),
	createTestFrameSet(3, 3, "Fourth frame (fills another gap)"),
];

// Process frames in the wrong order to test reordering
console.log("Receiving frames in order: 0, 2, 1, 4, 3");
console.log("Expected processing order: 0, 1, 2, 3, 4\n");

for (const frame of frames) {
	console.log(`\n--- Receiving frame set ${frame.sequence} ---`);
	try {
		session.onFrameSet(frame);
	} catch (error) {
		console.error(`Error processing frame ${frame.sequence}:`, error);
	}
}

console.log("\nTest completed!");
