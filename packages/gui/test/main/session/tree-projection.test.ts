import { describe, expect, test } from "vitest";
import { projectSessionTreeSnapshot } from "../../../src/main/session/tree-projection.ts";
import { sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";

describe("projectSessionTreeSnapshot", () => {
	test("projects nested Pi tree nodes into flat renderer entries with active path metadata", () => {
		const snapshot = projectSessionTreeSnapshot({
			workspaceId: workspaceIdFromString("workspace-1"),
			sessionId: sessionIdFromString("session-1"),
			leafEntryId: "assistant-1",
			now: () => new Date("2026-06-20T00:00:00.000Z"),
			getLabel: (entryId) => (entryId === "user-1" ? "start" : undefined),
			tree: [
				{
					entry: { uuid: "user-1", type: "message", role: "user", content: "Hello Pi" },
					children: [
						{
							entry: {
								uuid: "assistant-1",
								parentUuid: "user-1",
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "Hello human" }],
							},
							children: [],
						},
						{
							entry: {
								uuid: "tool-1",
								parentUuid: "user-1",
								type: "tool_result",
								toolName: "read",
								output: "file contents",
							},
							children: [],
						},
					],
				},
				{
					entry: {
						uuid: "compact-1",
						type: "compaction",
						summary: "Previous work summary",
						tokensBefore: 4200,
					},
					children: [],
				},
			],
		});

		expect(snapshot).toEqual({
			workspaceId: "workspace-1",
			sessionId: "session-1",
			leafEntryId: "assistant-1",
			updatedAt: "2026-06-20T00:00:00.000Z",
			entries: [
				expect.objectContaining({
					entryId: "user-1",
					parentId: null,
					childIds: ["assistant-1", "tool-1"],
					depth: 0,
					kind: "user",
					textPreview: "Hello Pi",
					label: "start",
					isActiveLeaf: false,
					isActivePath: true,
					hasChildren: true,
					searchText: "user Hello Pi start",
				}),
				expect.objectContaining({
					entryId: "assistant-1",
					parentId: "user-1",
					childIds: [],
					depth: 1,
					kind: "assistant",
					textPreview: "Hello human",
					isActiveLeaf: true,
					isActivePath: true,
					hasChildren: false,
					searchText: "assistant Hello human",
				}),
				expect.objectContaining({
					entryId: "tool-1",
					parentId: "user-1",
					childIds: [],
					depth: 1,
					kind: "tool",
					textPreview: "read: file contents",
					isActiveLeaf: false,
					isActivePath: false,
					hasChildren: false,
					searchText: "tool read: file contents",
				}),
				expect.objectContaining({
					entryId: "compact-1",
					parentId: null,
					childIds: [],
					depth: 0,
					kind: "compaction",
					textPreview: "Previous work summary",
					isActiveLeaf: false,
					isActivePath: false,
					hasChildren: false,
					searchText: "compaction Previous work summary",
				}),
			],
		});
	});
});
