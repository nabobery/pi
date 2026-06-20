import { describe, expect, test } from "vitest";
import {
	FAKE_RUNTIME_PROMPTS,
	FakeSessionDriver,
	PI_GUI_FAKE_DRIVER_ENV,
	shouldUseFakeSessionDriver,
} from "../../../src/main/session/fake-session-driver.ts";
import { workspaceIdFromString } from "../../../src/contracts/index.ts";

describe("shouldUseFakeSessionDriver", () => {
	test("requires both NODE_ENV=test and the explicit fake driver flag", () => {
		expect(shouldUseFakeSessionDriver({ NODE_ENV: "test", [PI_GUI_FAKE_DRIVER_ENV]: "1" })).toBe(true);
		expect(shouldUseFakeSessionDriver({ NODE_ENV: "development", [PI_GUI_FAKE_DRIVER_ENV]: "1" })).toBe(false);
		expect(shouldUseFakeSessionDriver({ NODE_ENV: "production", [PI_GUI_FAKE_DRIVER_ENV]: "1" })).toBe(false);
		expect(shouldUseFakeSessionDriver({ NODE_ENV: "test" })).toBe(false);
	});
});

describe("FakeSessionDriver", () => {
	test("opens sessions and emits deterministic runtime events", async () => {
		const driver = new FakeSessionDriver();
		const handle = await driver.openSession({
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
			sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.jsonl",
		});
		const events: string[] = [];
		const unsubscribe = driver.subscribe(handle, (event) => events.push(event.type));

		const modelThinking = await driver.getModelThinking(handle);
		expect(modelThinking.modelId).toBe("fake/model");
		await driver.setModel(handle);
		await driver.setThinkingLevel(handle);
		const result = await driver.sendMessage(handle, { message: "hello" });
		await result.completion;
		const transcript = await driver.getTranscript(handle);

		expect(handle.sessionManager.getSessionId()).toBe(handle.sessionId);
		expect(events).toEqual(["message_update", "tool_execution_start", "tool_execution_update", "tool_execution_end"]);
		expect(transcript.entries.at(-1)).toMatchObject({ kind: "assistant", text: "Fake reply." });
		unsubscribe();
		await driver.closeSession(handle);
	});

	test("supports queued steering and cancellation", async () => {
		const driver = new FakeSessionDriver();
		const handle = await driver.openSession({
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
			sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.jsonl",
		});

		await expect(driver.sendMessage(handle, { message: "steer", deliveryMode: "steer" })).resolves.toEqual({
			completion: expect.any(Promise),
		});
		await driver.sendMessage(handle, { message: "follow", deliveryMode: "followUp" });
		await expect(driver.getQueue(handle)).resolves.toMatchObject({
			steeringCount: 1,
			followUpCount: 1,
			steeringMessages: [{ text: "steer", kind: "steering" }],
			followUpMessages: [{ text: "follow", kind: "followUp" }],
		});
		await expect(driver.restoreQueuedMessages(handle)).resolves.toMatchObject({
			restoredMessages: [
				{ text: "steer", kind: "steering" },
				{ text: "follow", kind: "followUp" },
			],
			queue: { steeringCount: 0, followUpCount: 0 },
		});
		const delayed = await driver.sendMessage(handle, { message: FAKE_RUNTIME_PROMPTS.delay });
		await driver.cancelRun(handle);
		await driver.cancelRun(handle);

		await expect(delayed.completion).rejects.toThrow("Fake run cancelled");
		await driver.closeSession(handle);
	});

	test("rejects overlapping fake runs and invalid session paths", async () => {
		const driver = new FakeSessionDriver();
		const handle = await driver.openSession({
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
			sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.jsonl",
		});

		const delayed = await driver.sendMessage(handle, { message: FAKE_RUNTIME_PROMPTS.delay });
		await expect(driver.sendMessage(handle, { message: "second" })).rejects.toThrow("Fake run is already active");
		await driver.cancelRun(handle);
		await expect(delayed.completion).rejects.toThrow("Fake run cancelled");
		await expect(
			driver.openSession({
				workspaceId: workspaceIdFromString("workspace-1"),
				workspacePath: "/tmp/workspace",
				sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.txt",
			}),
		).rejects.toThrow("Fake session path must end with a .jsonl session file");
	});

	test("supports tree navigation, labels, compaction, exports, and slash command snapshots", async () => {
		const driver = new FakeSessionDriver();
		const handle = await driver.openSession({
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
			sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.jsonl",
		});
		const events: string[] = [];
		driver.subscribe(handle, (event) => events.push(event.type));

		const initialTree = await driver.getTree(handle);
		expect(initialTree.entries.map((entry) => entry.entryId)).toContain("fake-user-1");
		expect(handle.sessionManager.getEntry?.("fake-user-1")).toMatchObject({ id: "fake-user-1" });
		const labelledTree = await driver.setTreeEntryLabel(handle, "fake-user-1", " start ");
		expect(labelledTree.entries.find((entry) => entry.entryId === "fake-user-1")).toMatchObject({ label: "start" });
		const unlabelledTree = await driver.setTreeEntryLabel(handle, "fake-user-1", "");
		expect(unlabelledTree.entries.find((entry) => entry.entryId === "fake-user-1")?.label).toBeUndefined();

		await expect(
			driver.navigateTree(handle, {
				targetEntryId: "fake-user-1",
				summaryMode: "custom",
				customInstructions: "summarize branch",
			}),
		).resolves.toMatchObject({
			clearsComposer: false,
			editorText: "Fake user prompt",
		});
		await expect(
			driver.navigateTree(handle, { targetEntryId: "fake-assistant-1", summaryMode: "none" }),
		).resolves.toMatchObject({
			clearsComposer: true,
		});
		await expect(driver.navigateTree(handle, { targetEntryId: "missing", summaryMode: "none" })).rejects.toThrow(
			"Entry missing not found",
		);
		await expect(driver.setTreeEntryLabel(handle, "missing", "x")).rejects.toThrow("Entry missing not found");

		await expect(driver.compact(handle, "keep important facts")).resolves.toMatchObject({
			cancelled: false,
			firstKeptEntryId: "fake-entry-1",
			summary: "Compacted: keep important facts",
			tokensBefore: 1200,
		});
		await driver.cancelCompaction();
		await driver.cancelTreeNavigation();
		await expect(driver.exportSession(handle, { format: "html" })).resolves.toMatchObject({
			format: "html",
			outputPath: "/tmp/pi-gui-fake-session.html",
		});
		await expect(
			driver.exportSession(handle, { format: "jsonl", outputPath: "/tmp/custom.jsonl" }),
		).resolves.toMatchObject({
			format: "jsonl",
			outputPath: "/tmp/custom.jsonl",
		});
		await expect(driver.getSlashCommands()).resolves.toEqual([
			expect.objectContaining({ availability: "sendable", name: "fake-extension" }),
			expect.objectContaining({ availability: "insertOnly", name: "fake-prompt" }),
			expect.objectContaining({ availability: "sendable", name: "skill:fake-skill" }),
		]);
		expect(events).toContain("compaction_start");
		expect(events).toContain("compaction_end");
	});

	test("rejects closed fake runtime handles and closes active runs", async () => {
		const driver = new FakeSessionDriver();
		const handle = await driver.openSession({
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
			sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.jsonl",
		});

		const delayed = await driver.sendMessage(handle, { message: FAKE_RUNTIME_PROMPTS.delay });
		await driver.closeSession(handle);

		await expect(delayed.completion).rejects.toThrow("Fake session closed");
		await expect(driver.getTranscript(handle)).rejects.toThrow(
			"Fake session runtime workspace-1:session-1 is not open",
		);
	});
});
