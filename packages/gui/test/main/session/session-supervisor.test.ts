import { describe, expect, test, vi } from "vitest";
import {
	SessionCancelFailed,
	SessionCompactFailed,
	SessionOpenLimitReached,
	SessionRuntimeNotFound,
	SessionRuntimeCloseFailed,
	SessionRunNotActive,
	SessionTreeNavigationFailed,
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	extensionUiRequestIdFromString,
	type GuiEvent,
	type SessionCatalogSnapshot,
	type TimelineSnapshot,
	type SessionTreeSnapshot,
	type TreeNavigationSnapshot,
	type SessionCompactionSnapshot,
	type WorkspaceCatalogSnapshot,
	eventIdFromString,
	requestIdFromString,
} from "../../../src/contracts/index.ts";
import type {
	RuntimeSessionHandle,
	SendRuntimeMessageResult,
	SessionDriver,
} from "../../../src/main/session/session-driver.ts";
import { SessionSupervisor } from "../../../src/main/session/session-supervisor.ts";

describe("SessionSupervisor", () => {
	test("opens runtime records with workspace-scoped keys and emits opening, opened, and ready events", async () => {
		const fixture = createSupervisorFixture();

		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-b"), sessionIdFromString("session-1"));

		expect(fixture.driver.openSession).toHaveBeenCalledTimes(2);
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(true);
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-b"), sessionIdFromString("session-1")),
		).toBe(true);
		expect(fixture.events.map((event) => event._tag)).toEqual([
			"session.statusChanged",
			"session.opened",
			"modelThinking.updated",
			"session.statusChanged",
			"session.statusChanged",
			"session.opened",
			"modelThinking.updated",
			"session.statusChanged",
		]);
		expect(fixture.events[0]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "opening" },
		});
		expect(fixture.events[3]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "ready" },
		});
	});

	test("returns static transcript snapshots from the managed runtime", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		const snapshot = await fixture.supervisor.getTranscript(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
		);

		expect(snapshot).toEqual({
			workspaceId: "workspace-a",
			sessionId: "session-1",
			entries: [{ id: "entry-1", kind: "user", text: "hello" }],
		});
	});

	test("returns tree snapshots and publishes label updates", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		const tree = await fixture.supervisor.getTree(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
		);
		const labeled = await fixture.supervisor.setTreeEntryLabel(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
			"entry-1",
			"checkpoint",
		);

		expect(tree.entries[0]).toMatchObject({ entryId: "entry-1", kind: "user" });
		expect(labeled.entries[0]).toMatchObject({ label: "checkpoint" });
		expect(fixture.driver.setTreeEntryLabel).toHaveBeenCalledWith(expect.any(Object), "entry-1", "checkpoint");
		expect(fixture.events).toEqual([expect.objectContaining({ _tag: "tree.updated", tree: labeled })]);
	});

	test("navigates tree entries with status transitions and completion events", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		const result = await fixture.supervisor.navigateTree({
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			targetEntryId: "entry-1",
			summaryMode: "default",
		});

		expect(result).toMatchObject({ editorText: "hello", clearsComposer: false, cancelled: false });
		expect(fixture.driver.navigateTree).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({ targetEntryId: "entry-1", summaryMode: "default" }),
		);
		expect(fixture.events.map((event) => event._tag)).toEqual([
			"tree.navigationStarted",
			"session.statusChanged",
			"tree.updated",
			"tree.navigationCompleted",
			"session.statusChanged",
		]);
	});

	test("rejects tree navigation while a prompt run is active", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "hello",
		});

		await expect(
			fixture.supervisor.navigateTree({
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				targetEntryId: "entry-1",
				summaryMode: "none",
			}),
		).rejects.toBeInstanceOf(SessionTreeNavigationFailed);
	});

	test("manual compaction emits compaction events and refreshes transcript and tree", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		const result = await fixture.supervisor.compact(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
			"keep file edits",
		);

		expect(result).toMatchObject({ summary: "Compacted", tokensBefore: 1200, cancelled: false });
		expect(fixture.driver.compact).toHaveBeenCalledWith(expect.any(Object), "keep file edits");
		expect(fixture.events.map((event) => event._tag)).toEqual([
			"compaction.started",
			"session.statusChanged",
			"tree.updated",
			"compaction.completed",
			"session.statusChanged",
		]);
	});

	test("manual compaction ignores runtime compaction lifecycle events from the driver", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.driver.compact = vi.fn(async (handle): Promise<SessionCompactionSnapshot> => {
			fixture.emitRuntimeEvent({ type: "compaction_start", reason: "manual" });
			fixture.emitRuntimeEvent({
				type: "compaction_end",
				reason: "manual",
				result: { firstKeptEntryId: "entry-1", summary: "Compacted", tokensBefore: 1200 },
				aborted: false,
				willRetry: false,
			});
			return {
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				summary: "Compacted",
				firstKeptEntryId: "entry-1",
				tokensBefore: 1200,
				timeline: { workspaceId: handle.workspaceId, sessionId: handle.sessionId, entries: [] },
				tree: treeSnapshot(handle.workspaceId, handle.sessionId),
				cancelled: false,
			};
		});
		fixture.events.length = 0;

		await fixture.supervisor.compact(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
			"keep file edits",
		);

		expect(fixture.events.filter((event) => event._tag === "compaction.started")).toHaveLength(1);
		expect(fixture.events.filter((event) => event._tag === "compaction.completed")).toHaveLength(1);
		expect(fixture.events.map((event) => event._tag)).toEqual([
			"compaction.started",
			"session.statusChanged",
			"tree.updated",
			"compaction.completed",
			"session.statusChanged",
		]);
	});

	test("manual compaction cancellation emits only cancelled when the driver rejects after abort", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		let rejectCompaction: ((error: unknown) => void) | undefined;
		fixture.driver.compact = vi.fn(
			async () =>
				new Promise<SessionCompactionSnapshot>((_resolve, reject) => {
					rejectCompaction = reject;
				}),
		);
		fixture.events.length = 0;

		const compactPromise = fixture.supervisor.compact(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
			"keep file edits",
		);
		await waitForEvent(fixture.events, "compaction.started");
		await fixture.supervisor.cancelCompaction(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		rejectCompaction?.(new Error("aborted"));

		await expect(compactPromise).rejects.toBeInstanceOf(SessionCompactFailed);
		expect(fixture.events.filter((event) => event._tag === "compaction.cancelled")).toHaveLength(1);
		expect(fixture.events.map((event) => event._tag)).not.toContain("compaction.failed");
	});

	test("failed manual compaction cancellation restores failure handling", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		let rejectCompaction: ((error: unknown) => void) | undefined;
		fixture.driver.compact = vi.fn(
			async () =>
				new Promise<SessionCompactionSnapshot>((_resolve, reject) => {
					rejectCompaction = reject;
				}),
		);
		fixture.driver.cancelCompaction = vi.fn(async () => {
			throw new Error("abort failed");
		});
		fixture.events.length = 0;

		const compactPromise = fixture.supervisor.compact(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
			"keep file edits",
		);
		await waitForEvent(fixture.events, "compaction.started");
		await expect(
			fixture.supervisor.cancelCompaction(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toMatchObject({
			_tag: "SessionCancelFailed",
			cause: "abort failed",
		} satisfies Partial<SessionCancelFailed>);
		rejectCompaction?.(new Error("provider failed"));

		await expect(compactPromise).rejects.toBeInstanceOf(SessionCompactFailed);
		expect(fixture.events.map((event) => event._tag)).toContain("compaction.failed");
		expect(fixture.events.map((event) => event._tag)).not.toContain("compaction.cancelled");
		expect(fixture.events.at(-1)).toMatchObject({ _tag: "session.statusChanged", session: { status: "ready" } });
	});

	test("tree navigation cancellation publishes cancelling and ready status without failure", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		let resolveNavigation: ((snapshot: TreeNavigationSnapshot) => void) | undefined;
		fixture.driver.navigateTree = vi.fn(
			async (handle) =>
				new Promise<TreeNavigationSnapshot>((resolve) => {
					resolveNavigation = () =>
						resolve({
							workspaceId: handle.workspaceId,
							sessionId: handle.sessionId,
							tree: treeSnapshot(handle.workspaceId, handle.sessionId),
							timeline: { workspaceId: handle.workspaceId, sessionId: handle.sessionId, entries: [] },
							editorText: undefined,
							clearsComposer: false,
							cancelled: true,
						});
				}),
		);
		fixture.events.length = 0;

		const navigationPromise = fixture.supervisor.navigateTree({
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			targetEntryId: "entry-1",
			summaryMode: "default",
		});
		await waitForEvent(fixture.events, "tree.navigationStarted");
		await fixture.supervisor.cancelTreeNavigation(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
		);
		resolveNavigation?.({
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			tree: treeSnapshot("workspace-a", "session-1"),
			timeline: {
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				entries: [],
			},
			editorText: undefined,
			clearsComposer: false,
			cancelled: true,
		});
		await navigationPromise;

		expect(fixture.driver.cancelTreeNavigation).toHaveBeenCalledTimes(1);
		expect(fixture.events.map((event) => event._tag)).toEqual([
			"tree.navigationStarted",
			"session.statusChanged",
			"session.statusChanged",
			"tree.updated",
			"tree.navigationCompleted",
			"session.statusChanged",
		]);
		expect(fixture.events[2]).toMatchObject({ _tag: "session.statusChanged", session: { status: "cancelling" } });
	});

	test("failed tree navigation cancellation restores failure handling", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		let rejectNavigation: ((error: unknown) => void) | undefined;
		fixture.driver.navigateTree = vi.fn(
			async () =>
				new Promise<TreeNavigationSnapshot>((_resolve, reject) => {
					rejectNavigation = reject;
				}),
		);
		fixture.driver.cancelTreeNavigation = vi.fn(async () => {
			throw new Error("abort failed");
		});
		fixture.events.length = 0;

		const navigationPromise = fixture.supervisor.navigateTree({
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			targetEntryId: "entry-1",
			summaryMode: "default",
		});
		await waitForEvent(fixture.events, "tree.navigationStarted");
		await expect(
			fixture.supervisor.cancelTreeNavigation(
				workspaceIdFromString("workspace-a"),
				sessionIdFromString("session-1"),
			),
		).rejects.toMatchObject({
			_tag: "SessionCancelFailed",
			cause: "abort failed",
		} satisfies Partial<SessionCancelFailed>);
		rejectNavigation?.(new Error("provider failed"));

		await expect(navigationPromise).rejects.toBeInstanceOf(SessionTreeNavigationFailed);
		expect(fixture.events.map((event) => event._tag)).toContain("tree.navigationFailed");
		expect(fixture.events.at(-1)).toMatchObject({ _tag: "session.statusChanged", session: { status: "ready" } });
	});

	test("maps runtime-origin compaction end events to GUI completion, failure, and cancellation", async () => {
		const success = createSupervisorFixture();
		await success.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		success.events.length = 0;
		success.emitRuntimeEvent({ type: "compaction_start", reason: "threshold" });
		success.emitRuntimeEvent({
			type: "compaction_end",
			reason: "threshold",
			result: { firstKeptEntryId: "entry-1", summary: "Auto compacted", tokensBefore: 1200 },
			aborted: false,
			willRetry: false,
		});
		await waitForEvent(success.events, "compaction.completed");

		expect(success.events.map((event) => event._tag)).toEqual([
			"compaction.started",
			"session.statusChanged",
			"tree.updated",
			"compaction.completed",
			"session.statusChanged",
		]);
		expect(success.events.find((event) => event._tag === "compaction.completed")).toMatchObject({
			result: { summary: "Auto compacted", cancelled: false },
		});

		const failure = createSupervisorFixture();
		await failure.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		failure.events.length = 0;
		failure.emitRuntimeEvent({
			type: "compaction_end",
			reason: "threshold",
			result: undefined,
			aborted: false,
			willRetry: false,
			errorMessage: "provider failed",
		});

		expect(failure.events.map((event) => event._tag)).toEqual(["compaction.failed", "session.statusChanged"]);
		expect(failure.events[0]).toMatchObject({ error: { cause: "provider failed" } });

		const cancelled = createSupervisorFixture();
		await cancelled.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		cancelled.events.length = 0;
		cancelled.emitRuntimeEvent({
			type: "compaction_end",
			reason: "manual",
			result: undefined,
			aborted: true,
			willRetry: false,
		});

		expect(cancelled.events.map((event) => event._tag)).toEqual(["compaction.cancelled", "session.statusChanged"]);
	});

	test("rejects manual compaction while a prompt run is active", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "hello",
		});

		await expect(
			fixture.supervisor.compact(
				workspaceIdFromString("workspace-a"),
				sessionIdFromString("session-1"),
				"keep edits",
			),
		).rejects.toBeInstanceOf(SessionCompactFailed);
	});

	test("opening an already-open runtime only refreshes catalog selection", async () => {
		const fixture = createSupervisorFixture();

		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		expect(fixture.driver.openSession).toHaveBeenCalledTimes(1);
		expect(fixture.catalogService.openSession).toHaveBeenCalledTimes(2);
	});

	test("rejects opening a new runtime after the configured runtime limit", async () => {
		const fixture = createSupervisorFixture({ maxOpenSessions: 1 });

		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.catalogService.openSession.mockClear();

		await expect(
			fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-2")),
		).rejects.toBeInstanceOf(SessionOpenLimitReached);
		expect(fixture.driver.openSession).toHaveBeenCalledTimes(1);
		expect(fixture.catalogService.openSession).not.toHaveBeenCalled();
	});

	test("rejects creating a session after the configured runtime limit before mutating the catalog", async () => {
		const fixture = createSupervisorFixture({ maxOpenSessions: 1 });

		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await expect(fixture.supervisor.createSession(workspaceIdFromString("workspace-a"))).rejects.toBeInstanceOf(
			SessionOpenLimitReached,
		);
		expect(fixture.catalogService.createSession).not.toHaveBeenCalled();
	});

	test("close unsubscribes, disposes, removes the runtime record, and emits closed", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await fixture.supervisor.closeSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
		expect(fixture.driver.closeSession).toHaveBeenCalledTimes(1);
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(false);
		expect(fixture.events.at(-1)).toMatchObject({
			_tag: "session.closed",
			workspaceId: "workspace-a",
			sessionId: "session-1",
		});
	});

	test("close cancels pending extension UI requests before removing the runtime record", async () => {
		const fixture = createSupervisorFixture({
			extensionHostUiService: {
				cancelSessionRequests: vi.fn(),
				respond: vi.fn(),
				updateEditorText: vi.fn(),
			},
		});
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await fixture.supervisor.closeSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		expect(fixture.extensionHostUiService?.cancelSessionRequests).toHaveBeenCalledWith("workspace-a", "session-1");
	});

	test("extension UI response requires an installed extension UI service", () => {
		const fixture = createSupervisorFixture();

		expect(() =>
			fixture.supervisor.respondToExtensionUi({
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				extensionUiRequestId: extensionUiRequestIdFromString("extension-ui-1"),
				response: { kind: "confirm", confirmed: true },
			}),
		).toThrow(SessionRuntimeNotFound);
	});

	test("getTranscript returns a typed error when the runtime is not open", async () => {
		const fixture = createSupervisorFixture();

		await expect(
			fixture.supervisor.getTranscript(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toBeInstanceOf(SessionRuntimeNotFound);
	});

	test("open failure emits failed status and does not keep a runtime record", async () => {
		const fixture = createSupervisorFixture();
		fixture.driver.openSession = vi.fn(async () => {
			throw new Error("open failed");
		});

		await expect(
			fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toThrow("open failed");

		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(false);
		expect(fixture.events.map((event) => event._tag)).toEqual(["session.statusChanged", "session.statusChanged"]);
		expect(fixture.events[0]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "opening" },
		});
		expect(fixture.events[1]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "failed" },
		});
	});

	test("close failure keeps subscription and runtime record without emitting closed", async () => {
		const fixture = createSupervisorFixture();
		fixture.driver.closeSession = vi.fn(async () => {
			throw new SessionRuntimeCloseFailed({
				workspaceId: "workspace-a",
				sessionId: "session-1",
				sessionFilePath: "/tmp/workspace-a/session-1.jsonl",
				message: "Failed to close Pi session runtime",
			});
		});
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await expect(
			fixture.supervisor.closeSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toBeInstanceOf(SessionRuntimeCloseFailed);

		expect(fixture.unsubscribe).not.toHaveBeenCalled();
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(true);
		expect(fixture.events.map((event) => event._tag)).not.toContain("session.closed");
	});

	test("sendMessage emits accepted receipt, starts a run, streams deltas and tools, then completes with transcript", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "hello",
		});
		fixture.emitRuntimeEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hi" } });
		fixture.emitRuntimeEvent({
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "read",
			args: { path: "README.md" },
		});
		fixture.emitRuntimeEvent({
			type: "tool_execution_update",
			toolCallId: "tool-1",
			toolName: "read",
			args: { path: "README.md" },
			partialResult: "ok",
		});
		fixture.emitRuntimeEvent({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "read",
			result: "done",
			isError: false,
		});
		fixture.resolvePrompt();
		await waitForEvent(fixture.events, "run.completed");

		expect(fixture.events.map((event) => event._tag)).toEqual([
			"receipt.emitted",
			"run.started",
			"session.statusChanged",
			"timeline.messageDelta",
			"tool.started",
			"tool.updated",
			"tool.finished",
			"run.completed",
			"session.statusChanged",
		]);
		expect(fixture.events[0]).toMatchObject({ _tag: "receipt.emitted", receipt: "session.sendMessage.accepted" });
		expect(fixture.events[1]).toMatchObject({
			_tag: "run.started",
			workspaceId: "workspace-a",
			sessionId: "session-1",
		});
		expect(fixture.events[3]).toMatchObject({
			_tag: "timeline.messageDelta",
			workspaceId: "workspace-a",
			sessionId: "session-1",
			text: "Hi",
		});
		expect(fixture.events.at(-2)).toMatchObject({
			_tag: "run.completed",
			timeline: {
				workspaceId: "workspace-a",
				sessionId: "session-1",
				entries: [{ id: "entry-1", kind: "user", text: "hello" }],
			},
		});
	});

	test("sendMessage consumes selected image attachments and forwards them to the runtime driver", async () => {
		const imageAttachmentService = {
			clearSession: vi.fn(),
			consume: vi.fn(() => [{ type: "image" as const, data: "abcd", mimeType: "image/png" }]),
		};
		const fixture = createSupervisorFixture({ imageAttachmentService });
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "describe",
			attachmentIds: ["image-1"],
		});

		expect(imageAttachmentService.consume).toHaveBeenCalledWith("workspace-a", "session-1", ["image-1"]);
		expect(fixture.driver.sendMessage).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				message: "describe",
				images: [{ type: "image", data: "abcd", mimeType: "image/png" }],
			}),
		);
	});

	test("sendMessage prefers the send-time image attachment resolver when available", async () => {
		const imageAttachmentService = {
			clearSession: vi.fn(),
			consume: vi.fn(() => []),
			consumeForSend: vi.fn(async () => [{ type: "image" as const, data: "abcd", mimeType: "image/png" }]),
		};
		const fixture = createSupervisorFixture({ imageAttachmentService });
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "describe",
			attachmentIds: ["image-1"],
		});

		expect(imageAttachmentService.consumeForSend).toHaveBeenCalledWith("workspace-a", "session-1", ["image-1"]);
		expect(imageAttachmentService.consume).not.toHaveBeenCalled();
	});

	test("prompt preflight rejection does not start a run", async () => {
		const fixture = createSupervisorFixture();
		fixture.driver.sendMessage = vi.fn(async () => {
			throw new Error("missing key");
		});
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		await expect(
			fixture.supervisor.sendMessage({
				requestId: requestIdFromString("request-1"),
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				message: "hello",
			}),
		).rejects.toThrow("missing key");

		expect(fixture.events).toEqual([]);
	});

	test("post-acceptance prompt failure emits run.failed and failed status", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "hello",
		});
		fixture.rejectPrompt(new Error("provider failed"));
		await waitForEvent(fixture.events, "run.failed");

		expect(fixture.events.at(-2)).toMatchObject({
			_tag: "run.failed",
			error: { _tag: "SessionPromptFailed", cause: "provider failed" },
		});
		expect(fixture.events.at(-1)).toMatchObject({
			_tag: "session.statusChanged",
			session: { status: "failed" },
		});
	});

	test.each(["steer", "followUp"] as const)(
		"delivery mode %s is accepted as active-run input without starting or completing a new run",
		async (deliveryMode) => {
			const fixture = createSupervisorFixture();
			await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
			fixture.events.length = 0;

			await fixture.supervisor.sendMessage({
				requestId: requestIdFromString("request-1"),
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				message: "hello",
			});
			fixture.events.length = 0;

			await fixture.supervisor.sendMessage({
				requestId: requestIdFromString("request-2"),
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				message: "adjust",
				deliveryMode,
			});
			fixture.resolvePrompt();
			await flushAsyncRunHandlers();

			expect(fixture.driver.sendMessage).toHaveBeenLastCalledWith(
				expect.any(Object),
				expect.objectContaining({ message: "adjust", deliveryMode }),
			);
			expect(fixture.events.map((event) => event._tag)).toEqual(["receipt.emitted"]);
			expect(fixture.events[0]).toMatchObject({
				_tag: "receipt.emitted",
				receipt: "session.sendMessage.accepted",
				requestId: "request-2",
			});
		},
	);

	test("runtime queue updates include full queue snapshots and activity state", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		fixture.emitRuntimeEvent({ type: "queue_update", steering: ["steer"], followUp: ["follow"] });

		expect(fixture.events).toEqual([
			expect.objectContaining({
				_tag: "queue.updated",
				workspaceId: "workspace-a",
				sessionId: "session-1",
				steeringCount: 1,
				followUpCount: 1,
				steeringMessages: [{ index: 0, kind: "steering", text: "steer" }],
				followUpMessages: [{ index: 0, kind: "followUp", text: "follow" }],
				steeringMode: "all",
				followUpMode: "all",
			}),
			expect.objectContaining({
				_tag: "session.activityUpdated",
				activity: expect.objectContaining({
					workspaceId: "workspace-a",
					sessionId: "session-1",
					queueCount: 2,
				}),
			}),
		]);
	});

	test("restores queued messages through the driver and relies on the runtime queue update", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.driver.restoreQueuedMessages = vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			restoredMessages: [{ index: 0, kind: "steering" as const, text: "queued steer" }],
			queue: {
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				steeringMessages: [],
				followUpMessages: [],
				steeringCount: 0,
				followUpCount: 0,
				steeringMode: "all" as const,
				followUpMode: "all" as const,
			},
		}));
		fixture.events.length = 0;

		const restored = await fixture.supervisor.restoreQueuedMessages(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
		);

		expect(restored.restoredMessages).toEqual([{ index: 0, kind: "steering", text: "queued steer" }]);
		expect(fixture.driver.restoreQueuedMessages).toHaveBeenCalledTimes(1);
		expect(fixture.events).toEqual([]);
		fixture.emitRuntimeEvent({ type: "queue_update", steering: [], followUp: [] });
		expect(fixture.events.map((event) => event._tag)).toEqual(["queue.updated", "session.activityUpdated"]);
		expect(fixture.events[0]).toMatchObject({ _tag: "queue.updated", steeringCount: 0, followUpCount: 0 });
	});

	test("delivery mode send requires an active run", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;

		await expect(
			fixture.supervisor.sendMessage({
				requestId: requestIdFromString("request-1"),
				workspaceId: workspaceIdFromString("workspace-a"),
				sessionId: sessionIdFromString("session-1"),
				message: "adjust",
				deliveryMode: "steer",
			}),
		).rejects.toBeInstanceOf(SessionRunNotActive);

		expect(fixture.driver.sendMessage).not.toHaveBeenCalled();
		expect(fixture.events).toEqual([]);
	});

	test("cancelRun requires an active run and emits run.cancelled", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await expect(
			fixture.supervisor.cancelRun(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toBeInstanceOf(SessionRunNotActive);

		fixture.events.length = 0;
		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "hello",
		});
		await fixture.supervisor.cancelRun(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		expect(fixture.driver.cancelRun).toHaveBeenCalledTimes(1);
		expect(fixture.events.at(-2)).toMatchObject({ _tag: "run.cancelled" });
		expect(fixture.events.at(-1)).toMatchObject({
			_tag: "session.statusChanged",
			session: { status: "ready" },
		});
	});

	test("cancelRun failure restores running status and keeps the active run cancellable", async () => {
		const fixture = createSupervisorFixture();
		fixture.driver.cancelRun = vi.fn(async () => {
			throw new Error("abort failed");
		});
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		fixture.events.length = 0;
		await fixture.supervisor.sendMessage({
			requestId: requestIdFromString("request-1"),
			workspaceId: workspaceIdFromString("workspace-a"),
			sessionId: sessionIdFromString("session-1"),
			message: "hello",
		});
		fixture.events.length = 0;

		await expect(
			fixture.supervisor.cancelRun(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toMatchObject({
			_tag: "SessionCancelFailed",
			cause: "abort failed",
		} satisfies Partial<SessionCancelFailed>);

		expect(fixture.events.map((event) => event._tag)).toEqual(["session.statusChanged", "session.statusChanged"]);
		expect(fixture.events[0]).toMatchObject({ _tag: "session.statusChanged", session: { status: "cancelling" } });
		expect(fixture.events[1]).toMatchObject({ _tag: "session.statusChanged", session: { status: "running" } });
		expect(fixture.events.map((event) => event._tag)).not.toContain("run.cancelled");
		fixture.driver.cancelRun = vi.fn(async () => undefined);
		await fixture.supervisor.cancelRun(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		expect(fixture.driver.cancelRun).toHaveBeenCalledTimes(1);
	});
});

function createSupervisorFixture(
	options: {
		extensionHostUiService?: ConstructorParameters<typeof SessionSupervisor>[0]["extensionHostUiService"];
		imageAttachmentService?: ConstructorParameters<typeof SessionSupervisor>[0]["imageAttachmentService"];
		maxOpenSessions?: number;
	} = {},
) {
	const workspaceCatalog: WorkspaceCatalogSnapshot = {
		revision: catalogRevisionFromString("1"),
		selectedWorkspaceId: workspaceIdFromString("workspace-a"),
		workspaces: [
			{
				id: workspaceIdFromString("workspace-a"),
				path: "/tmp/workspace-a",
				name: "workspace-a",
				lastOpenedAt: "2026-06-18T00:00:00.000Z",
				sortOrder: 0,
				missing: false,
			},
			{
				id: workspaceIdFromString("workspace-b"),
				path: "/tmp/workspace-b",
				name: "workspace-b",
				lastOpenedAt: "2026-06-18T00:00:00.000Z",
				sortOrder: 1,
				missing: false,
			},
		],
	};
	const catalogService = {
		createSession: vi.fn((workspaceId) => Promise.resolve(createSessionCatalog(workspaceId))),
		getSessionCatalog: vi.fn((workspaceId) => Promise.resolve(createSessionCatalog(workspaceId))),
		getWorkspaceCatalog: vi.fn(() => Promise.resolve(workspaceCatalog)),
		openSession: vi.fn((workspaceId, sessionId) => Promise.resolve(createSessionCatalog(workspaceId, sessionId))),
	};
	const unsubscribe = vi.fn();
	let runtimeListener: ((event: unknown) => void) | undefined;
	let resolvePromptCompletion: (() => void) | undefined;
	let rejectPromptCompletion: ((error: unknown) => void) | undefined;
	const driver: SessionDriver = {
		openSession: vi.fn(async (request) =>
			createHandle(request.workspaceId, request.workspacePath, deriveSessionId(request.sessionFilePath)),
		),
		cancelCompaction: vi.fn(async () => undefined),
		cancelRun: vi.fn(async () => undefined),
		cancelTreeNavigation: vi.fn(async () => undefined),
		closeSession: vi.fn(async () => undefined),
		compact: vi.fn(
			async (handle, customInstructions): Promise<SessionCompactionSnapshot> => ({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				summary: customInstructions ? "Compacted" : "Compacted",
				firstKeptEntryId: "entry-1",
				tokensBefore: 1200,
				timeline: {
					workspaceId: handle.workspaceId,
					sessionId: handle.sessionId,
					entries: [{ id: "entry-1", kind: "user", text: "hello" }],
				},
				tree: treeSnapshot(handle.workspaceId, handle.sessionId),
				cancelled: false,
			}),
		),
		exportSession: vi.fn(async (handle, request) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			format: request.format,
			outputPath: request.outputPath ?? `/tmp/session.${request.format}`,
		})),
		getModelThinking: vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			thinkingLevel: "off" as const,
			availableThinkingLevels: ["off" as const],
			models: [],
		})),
		getQueue: vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			steeringMessages: [],
			followUpMessages: [],
			steeringCount: 0,
			followUpCount: 0,
			steeringMode: "all" as const,
			followUpMode: "all" as const,
		})),
		getTranscript: vi.fn(
			async (handle): Promise<TimelineSnapshot> => ({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				entries: [{ id: "entry-1", kind: "user", text: "hello" }],
			}),
		),
		getTree: vi.fn(
			async (handle): Promise<SessionTreeSnapshot> => treeSnapshot(handle.workspaceId, handle.sessionId),
		),
		navigateTree: vi.fn(
			async (handle): Promise<TreeNavigationSnapshot> => ({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				tree: treeSnapshot(handle.workspaceId, handle.sessionId),
				timeline: {
					workspaceId: handle.workspaceId,
					sessionId: handle.sessionId,
					entries: [{ id: "entry-1", kind: "user", text: "hello" }],
				},
				editorText: "hello",
				clearsComposer: false,
				cancelled: false,
			}),
		),
		setModel: vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			thinkingLevel: "off" as const,
			availableThinkingLevels: ["off" as const],
			models: [],
		})),
		setThinkingLevel: vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			thinkingLevel: "off" as const,
			availableThinkingLevels: ["off" as const],
			models: [],
		})),
		setTreeEntryLabel: vi.fn(
			async (handle, _entryId, label): Promise<SessionTreeSnapshot> =>
				treeSnapshot(handle.workspaceId, handle.sessionId, label),
		),
		sendMessage: vi.fn(
			async (): Promise<SendRuntimeMessageResult> =>
				new Promise<SendRuntimeMessageResult>((resolve) => {
					const completion = new Promise<void>((complete, reject) => {
						resolvePromptCompletion = complete;
						rejectPromptCompletion = reject;
					});
					resolve({ completion });
				}),
		),
		restoreQueuedMessages: vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			restoredMessages: [],
			queue: {
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				steeringMessages: [],
				followUpMessages: [],
				steeringCount: 0,
				followUpCount: 0,
				steeringMode: "all" as const,
				followUpMode: "all" as const,
			},
		})),
		subscribe: vi.fn((_handle, listener) => {
			runtimeListener = listener;
			return unsubscribe;
		}),
	};
	const events: GuiEvent[] = [];
	let sequence = 0;
	const eventBus = {
		nextEventBase: () => {
			sequence += 1;
			return { eventId: eventIdFromString(`event-${sequence}`), sequence };
		},
		publish: (event: GuiEvent) => {
			events.push(event);
		},
	};

	return {
		catalogService,
		driver,
		emitRuntimeEvent: (event: unknown) => runtimeListener?.(event),
		events,
		rejectPrompt: (error: unknown) => rejectPromptCompletion?.(error),
		resolvePrompt: () => resolvePromptCompletion?.(),
		extensionHostUiService: options.extensionHostUiService,
		supervisor: new SessionSupervisor({
			catalogService,
			driver,
			eventBus,
			...(options.extensionHostUiService ? { extensionHostUiService: options.extensionHostUiService } : {}),
			...(options.imageAttachmentService ? { imageAttachmentService: options.imageAttachmentService } : {}),
			...(options.maxOpenSessions ? { maxOpenSessions: options.maxOpenSessions } : {}),
		}),
		unsubscribe,
	};
}

function createSessionCatalog(
	workspaceId: string,
	sessionId = sessionIdFromString("session-1"),
): SessionCatalogSnapshot {
	return {
		workspaceId: workspaceIdFromString(workspaceId),
		selectedSessionId: sessionId,
		sessions: [
			{
				id: sessionId,
				workspaceId: workspaceIdFromString(workspaceId),
				title: "Session",
				status: "idle",
				updatedAt: "2026-06-18T00:00:00.000Z",
				preview: "",
				messageCount: 1,
				sessionFilePath: `/tmp/${workspaceId}/${sessionId}.jsonl`,
			},
		],
	};
}

function createHandle(
	workspaceId: string,
	workspacePath: string,
	sessionId = sessionIdFromString("session-1"),
): RuntimeSessionHandle {
	return {
		key: `${workspaceId}:${sessionId}`,
		runtime: {
			session: {
				abort: vi.fn(async () => undefined),
				abortBranchSummary: vi.fn(),
				abortCompaction: vi.fn(),
				bindExtensions: vi.fn(),
				clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
				compact: vi.fn(async () => ({
					firstKeptEntryId: "entry-1",
					summary: "Compacted",
					tokensBefore: 1200,
				})),
				followUpMode: "all",
				getAvailableThinkingLevels: vi.fn(() => ["off" as const]),
				getFollowUpMessages: vi.fn(() => []),
				getSteeringMessages: vi.fn(() => []),
				navigateTree: vi.fn(async () => ({ editorText: "hello", cancelled: false })),
				thinkingLevel: "off" as const,
				setModel: vi.fn(async () => undefined),
				setThinkingLevel: vi.fn(),
				steeringMode: "all",
				supportsThinking: vi.fn(() => false),
				prompt: vi.fn(async () => undefined),
				subscribe: vi.fn(() => vi.fn()),
			},
			dispose: vi.fn(),
		},
		sessionFilePath: `/tmp/${workspaceId}/${sessionId}.jsonl`,
		sessionId,
		sessionManager: {
			appendLabelChange: () => "label-1",
			getEntry: () => undefined,
			getEntries: () => [],
			getLabel: () => undefined,
			getLeafId: () => "entry-1",
			getSessionId: () => sessionId,
			getTree: () => [],
		},
		workspaceId: workspaceIdFromString(workspaceId),
		workspacePath,
	};
}

function treeSnapshot(workspaceId: string, sessionId: string, label?: string): SessionTreeSnapshot {
	return {
		workspaceId: workspaceIdFromString(workspaceId),
		sessionId: sessionIdFromString(sessionId),
		leafEntryId: "entry-1",
		updatedAt: "2026-06-20T00:00:00.000Z",
		entries: [
			{
				entryId: "entry-1",
				parentId: null,
				childIds: [],
				depth: 0,
				kind: "user",
				textPreview: "hello",
				...(label ? { label } : {}),
				isActiveLeaf: true,
				isActivePath: true,
				hasChildren: false,
				searchText: label ? `user hello ${label}` : "user hello",
			},
		],
	};
}

function deriveSessionId(sessionFilePath: string): ReturnType<typeof sessionIdFromString> {
	const fileName = sessionFilePath.slice(sessionFilePath.lastIndexOf("/") + 1);
	return sessionIdFromString(fileName.slice(0, -".jsonl".length));
}

async function waitForEvent(events: readonly GuiEvent[], tag: GuiEvent["_tag"]): Promise<void> {
	return new Promise((resolve, reject) => {
		let attempt = 0;
		const check = () => {
			attempt += 1;
			if (events.some((event) => event._tag === tag)) {
				resolve();
				return;
			}
			if (attempt >= 20) {
				reject(new Error(`Timed out waiting for ${tag}`));
				return;
			}
			setTimeout(check, 0);
		};
		check();
	});
}

async function flushAsyncRunHandlers(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
