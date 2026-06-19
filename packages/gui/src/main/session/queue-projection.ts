import type { QueueMessageSnapshot, QueueMode, QueueRestoreSnapshot, QueueSnapshot } from "../../contracts/index.ts";
import type { RuntimeSessionHandle } from "./session-driver.ts";

export function projectQueueSnapshot(
	handle: RuntimeSessionHandle,
	queue: { steering: readonly string[]; followUp: readonly string[] },
	modes: { steeringMode: QueueMode; followUpMode: QueueMode },
): QueueSnapshot {
	const steeringMessages = queue.steering.map(
		(text, index): QueueMessageSnapshot => ({
			index,
			text,
			kind: "steering",
		}),
	);
	const followUpMessages = queue.followUp.map(
		(text, index): QueueMessageSnapshot => ({
			index,
			text,
			kind: "followUp",
		}),
	);
	return {
		workspaceId: handle.workspaceId,
		sessionId: handle.sessionId,
		steeringMessages,
		followUpMessages,
		steeringCount: steeringMessages.length,
		followUpCount: followUpMessages.length,
		steeringMode: modes.steeringMode,
		followUpMode: modes.followUpMode,
	};
}

export function projectQueueRestoreSnapshot(
	handle: RuntimeSessionHandle,
	restored: { steering: readonly string[]; followUp: readonly string[] },
	queue: QueueSnapshot,
): QueueRestoreSnapshot {
	return {
		workspaceId: handle.workspaceId,
		sessionId: handle.sessionId,
		restoredMessages: [
			...restored.steering.map((text, index): QueueMessageSnapshot => ({ index, text, kind: "steering" })),
			...restored.followUp.map((text, index): QueueMessageSnapshot => ({ index, text, kind: "followUp" })),
		],
		queue,
	};
}
