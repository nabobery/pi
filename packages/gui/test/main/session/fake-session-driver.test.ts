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
});
