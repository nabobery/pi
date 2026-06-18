import { describe, expect, test } from "vitest";
import { sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { createRuntimeSessionKey } from "../../../src/main/session/session-key.ts";

describe("createRuntimeSessionKey", () => {
	test("separates identical session ids across workspaces", () => {
		const sessionId = sessionIdFromString("session-1");
		const firstWorkspaceId = workspaceIdFromString("workspace-a");
		const secondWorkspaceId = workspaceIdFromString("workspace-b");

		expect(createRuntimeSessionKey(firstWorkspaceId, sessionId)).toBe("workspace-a:session-1");
		expect(createRuntimeSessionKey(secondWorkspaceId, sessionId)).toBe("workspace-b:session-1");
		expect(createRuntimeSessionKey(firstWorkspaceId, sessionId)).not.toBe(
			createRuntimeSessionKey(secondWorkspaceId, sessionId),
		);
	});
});
