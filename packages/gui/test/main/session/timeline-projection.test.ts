import { describe, expect, test } from "vitest";
import { sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { projectTimelineSnapshot } from "../../../src/main/session/timeline-projection.ts";

describe("projectTimelineSnapshot", () => {
	test("projects static transcript entries from persisted message roles", () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		const snapshot = projectTimelineSnapshot(workspaceId, sessionId, [
			{
				id: "entry-user",
				message: { role: "user", content: "hello" },
			},
			{
				id: "entry-assistant",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "hi" },
						{ type: "image", image: "ignored" },
					],
				},
			},
			{
				id: "entry-tool",
				message: { role: "tool", content: [{ type: "text", text: "done" }] },
			},
			{
				id: "entry-system",
				type: "compaction",
				summary: "summary text",
			},
		]);

		expect(snapshot).toEqual({
			workspaceId,
			sessionId,
			entries: [
				{ id: "entry-user", kind: "user", text: "hello" },
				{ id: "entry-assistant", kind: "assistant", text: "hi" },
				{ id: "entry-tool", kind: "tool", text: "done" },
				{ id: "entry-system", kind: "system", text: "summary text" },
			],
		});
	});
});
