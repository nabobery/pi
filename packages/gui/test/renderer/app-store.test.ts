import { describe, expect, test, vi } from "vitest";
import {
	ExtensionUiRequested,
	ExtensionUiResolved,
	ExtensionUiUpdated,
	ExtensionUiUpdateEditorText,
	SessionCatalogUpdated,
	RunCancelled,
	RunCompleted,
	RunFailed,
	RunStarted,
	SessionClosed,
	SessionCancelRun,
	SessionSelected,
	SessionSendMessage,
	SessionPromptFailed,
	SessionStatusChanged,
	TimelineMessageDelta,
	ToolFinished,
	ToolStarted,
	ToolUpdated,
	type TimelineSnapshot,
	type GuiEvent,
	InternalIpcError,
	SessionCreate,
	WorkspaceCatalogUpdated,
	catalogRevisionFromString,
	eventIdFromString,
	extensionUiRequestIdFromString,
	requestIdFromString,
	runIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../src/contracts/index.ts";
import { createGuiCatalogStore, createValidatedRendererCatalogApi } from "../../src/renderer/app/app-store.ts";

describe("createGuiCatalogStore", () => {
	test("applies workspace and session catalog events", () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		listeners[0](
			new WorkspaceCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				catalog: {
					revision: catalogRevisionFromString("1"),
					selectedWorkspaceId: workspaceId,
					workspaces: [
						{
							id: workspaceId,
							path: "/tmp/workspace",
							name: "workspace",
							lastOpenedAt: "2026-06-18T00:00:00.000Z",
							sortOrder: 0,
							missing: false,
							selected: true,
						},
					],
				},
			}),
		);
		listeners[0](
			new SessionCatalogUpdated({
				eventId: eventIdFromString("event-2"),
				sequence: 2,
				workspaceId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session",
						status: "idle",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "hello",
						messageCount: 1,
					},
				],
			}),
		);
		listeners[0](
			new SessionSelected({
				eventId: eventIdFromString("event-3"),
				sequence: 3,
				workspaceId,
				sessionId,
			}),
		);

		expect(store.getSnapshot()).toMatchObject({
			workspaceCatalog: {
				selectedWorkspaceId: workspaceId,
				workspaces: [expect.objectContaining({ id: workspaceId })],
			},
			sessionCatalogs: {
				[workspaceId]: {
					selectedSessionId: sessionId,
					sessions: [expect.objectContaining({ id: sessionId, title: "Session" })],
				},
			},
		});
	});

	test("applies runtime status, closed events, and transcript results", async () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const timeline: TimelineSnapshot = {
			workspaceId,
			sessionId,
			entries: [{ id: "entry-1", kind: "user", text: "hello" }],
		};
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn().mockResolvedValue({
					ok: true,
					requestId: requestIdFromString("request-1"),
					data: timeline,
				}),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);

		listeners[0](
			new SessionCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				workspaceId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session",
						status: "opening",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "",
						messageCount: 1,
					},
				],
			}),
		);
		listeners[0](
			new SessionSelected({
				eventId: eventIdFromString("event-2"),
				sequence: 2,
				workspaceId,
				sessionId,
			}),
		);
		listeners[0](
			new SessionStatusChanged({
				eventId: eventIdFromString("event-3"),
				sequence: 3,
				session: {
					id: sessionId,
					workspaceId,
					title: "Session",
					status: "ready",
					updatedAt: "2026-06-18T00:00:00.000Z",
					preview: "",
					messageCount: 1,
				},
			}),
		);
		await store.getTranscript(workspaceId, sessionId);

		expect(store.getSnapshot().sessionCatalogs[workspaceId].sessions[0].status).toBe("ready");
		expect(store.getSnapshot().timelines[`${workspaceId}:${sessionId}`]).toEqual(timeline);

		listeners[0](
			new SessionClosed({
				eventId: eventIdFromString("event-4"),
				sequence: 4,
				workspaceId,
				sessionId,
			}),
		);

		expect(store.getSnapshot().sessionCatalogs[workspaceId].sessions[0].status).toBe("closed");
		expect(store.getSnapshot().timelines[`${workspaceId}:${sessionId}`]).toBeUndefined();
	});

	test("stores transcript results by explicit workspace identity when session IDs collide", async () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const workspaceA = workspaceIdFromString("workspace-a");
		const workspaceB = workspaceIdFromString("workspace-b");
		const sessionId = sessionIdFromString("session-1");
		const timeline: TimelineSnapshot = {
			workspaceId: workspaceB,
			sessionId,
			entries: [{ id: "entry-b", kind: "assistant", text: "workspace b" }],
		};
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn().mockResolvedValue({
					ok: true,
					requestId: requestIdFromString("request-1"),
					data: timeline,
				}),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);

		for (const workspaceId of [workspaceA, workspaceB]) {
			listeners[0](
				new SessionCatalogUpdated({
					eventId: eventIdFromString(`event-${workspaceId}`),
					sequence: 1,
					workspaceId,
					sessions: [
						{
							id: sessionId,
							workspaceId,
							title: `Session ${workspaceId}`,
							status: "ready",
							updatedAt: "2026-06-18T00:00:00.000Z",
							preview: "",
							messageCount: 1,
						},
					],
				}),
			);
		}
		await store.getTranscript(workspaceB, sessionId);

		expect(store.getSnapshot().timelines[`${workspaceA}:${sessionId}`]).toBeUndefined();
		expect(store.getSnapshot().timelines[`${workspaceB}:${sessionId}`]).toEqual(timeline);
	});

	test("keeps composer drafts per workspace session and sends prompt commands", async () => {
		const invoke = vi.fn().mockResolvedValue({
			ok: true,
			requestId: requestIdFromString("request-1"),
			data: undefined,
		});
		const workspaceA = workspaceIdFromString("workspace-a");
		const workspaceB = workspaceIdFromString("workspace-b");
		const sessionId = sessionIdFromString("session-1");
		const store = createGuiCatalogStore(
			{
				invoke,
				subscribe: () => () => undefined,
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);

		store.setComposerDraft(workspaceA, sessionId, "first");
		store.setComposerDraft(workspaceB, sessionId, "second");
		await store.sendMessage(workspaceA, sessionId, "steer now", "steer");
		await store.cancelRun(workspaceA, sessionId);

		expect(store.getSnapshot().composerDrafts).toEqual({
			"workspace-a:session-1": "first",
			"workspace-b:session-1": "second",
		});
		expect(invoke).toHaveBeenCalledWith(expect.any(SessionSendMessage));
		expect(invoke).toHaveBeenCalledWith(expect.any(SessionCancelRun));
		const sendCommand = invoke.mock.calls
			.map((call) => call[0])
			.find((command) => command._tag === "session.sendMessage");
		expect(sendCommand).toMatchObject({
			_tag: "session.sendMessage",
			workspaceId: workspaceA,
			sessionId,
			message: "steer now",
			deliveryMode: "steer",
		});
	});

	test("reports prompt acceptance and preserves drafts when send is rejected before acceptance", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const acceptedInvoke = vi.fn().mockResolvedValue({
			ok: true,
			requestId: requestIdFromString("request-1"),
			data: undefined,
		});
		const rejectedInvoke = vi.fn().mockResolvedValue({
			ok: false,
			requestId: requestIdFromString("request-2"),
			error: new InternalIpcError({ message: "Missing model" }),
		});
		const acceptedStore = createGuiCatalogStore(
			{
				invoke: acceptedInvoke,
				subscribe: () => () => undefined,
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		const rejectedStore = createGuiCatalogStore(
			{
				invoke: rejectedInvoke,
				subscribe: () => () => undefined,
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);

		rejectedStore.setComposerDraft(workspaceId, sessionId, "keep this");

		await expect(acceptedStore.sendMessage(workspaceId, sessionId, "hello")).resolves.toBe(true);
		await expect(rejectedStore.sendMessage(workspaceId, sessionId, "hello")).resolves.toBe(false);

		expect(rejectedStore.getSnapshot().composerDrafts["workspace-1:session-1"]).toBe("keep this");
		expect(rejectedStore.getSnapshot().error).toBe("Missing model");
	});

	test("applies prompt runtime events into live and final timeline state", () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const runId = runIdFromString("run-1");
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		listeners[0](
			new SessionCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				workspaceId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session",
						status: "ready",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "",
						messageCount: 1,
					},
				],
			}),
		);

		listeners[0](
			new RunStarted({ eventId: eventIdFromString("event-2"), sequence: 2, workspaceId, sessionId, runId }),
		);
		listeners[0](
			new TimelineMessageDelta({
				eventId: eventIdFromString("event-3"),
				sequence: 3,
				workspaceId,
				sessionId,
				runId,
				text: "Hel",
			}),
		);
		listeners[0](
			new TimelineMessageDelta({
				eventId: eventIdFromString("event-4"),
				sequence: 4,
				workspaceId,
				sessionId,
				runId,
				text: "lo",
			}),
		);
		listeners[0](
			new ToolStarted({
				eventId: eventIdFromString("event-5"),
				sequence: 5,
				workspaceId,
				sessionId,
				runId,
				toolCallId: "tool-1",
				toolName: "read",
			}),
		);
		listeners[0](
			new ToolUpdated({
				eventId: eventIdFromString("event-6"),
				sequence: 6,
				workspaceId,
				sessionId,
				runId,
				toolCallId: "tool-1",
				text: "reading",
			}),
		);
		listeners[0](
			new ToolFinished({
				eventId: eventIdFromString("event-7"),
				sequence: 7,
				workspaceId,
				sessionId,
				runId,
				toolCallId: "tool-1",
				isError: false,
			}),
		);

		expect(store.getSnapshot().sessionCatalogs[workspaceId].sessions[0].status).toBe("running");
		expect(store.getSnapshot().timelines["workspace-1:session-1"]).toEqual({
			workspaceId,
			sessionId,
			entries: [
				{ id: "live:run-1:assistant", kind: "assistant", text: "Hello", isLive: true },
				{
					id: "tool:tool-1",
					kind: "tool",
					text: "reading",
					toolCallId: "tool-1",
					toolName: "read",
					isLive: false,
					isError: false,
				},
			],
		});

		const finalTimeline: TimelineSnapshot = {
			workspaceId,
			sessionId,
			entries: [{ id: "entry-1", kind: "assistant", text: "Final" }],
		};
		listeners[0](
			new RunCompleted({
				eventId: eventIdFromString("event-8"),
				sequence: 8,
				workspaceId,
				sessionId,
				runId,
				timeline: finalTimeline,
			}),
		);
		expect(store.getSnapshot().timelines["workspace-1:session-1"]).toEqual(finalTimeline);
		expect(store.getSnapshot().sessionCatalogs[workspaceId].sessions[0].status).toBe("ready");
	});

	test("applies prompt failure and cancellation states", () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const runId = runIdFromString("run-1");
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		listeners[0](
			new SessionCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				workspaceId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session",
						status: "ready",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "",
						messageCount: 1,
					},
				],
			}),
		);
		listeners[0](
			new RunFailed({
				eventId: eventIdFromString("event-2"),
				sequence: 2,
				workspaceId,
				sessionId,
				runId,
				error: new SessionPromptFailed({
					workspaceId,
					sessionId,
					runId,
					message: "Prompt failed",
				}),
			}),
		);
		expect(store.getSnapshot().error).toBe("Prompt failed");
		expect(store.getSnapshot().sessionCatalogs[workspaceId].sessions[0].status).toBe("failed");
		expect(store.getSnapshot().timelines["workspace-1:session-1"].entries.at(-1)).toMatchObject({
			kind: "error",
			text: "Prompt failed",
		});

		listeners[0](
			new RunStarted({ eventId: eventIdFromString("event-3"), sequence: 3, workspaceId, sessionId, runId }),
		);
		listeners[0](
			new RunCancelled({ eventId: eventIdFromString("event-4"), sequence: 4, workspaceId, sessionId, runId }),
		);
		expect(store.getSnapshot().sessionCatalogs[workspaceId].sessions[0].status).toBe("ready");
	});

	test("keeps the IPC subscription alive across React listener cleanup and resubscribe", () => {
		const eventListeners: Array<(event: GuiEvent) => void> = [];
		const unsubscribeIpc = vi.fn();
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					eventListeners.push(listener);
					return unsubscribeIpc;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		const firstListener = vi.fn();
		const secondListener = vi.fn();
		const workspaceId = workspaceIdFromString("workspace-1");

		const unsubscribeFirst = store.subscribe(firstListener);
		unsubscribeFirst();
		const unsubscribeSecond = store.subscribe(secondListener);
		eventListeners[0](
			new WorkspaceCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				catalog: {
					revision: catalogRevisionFromString("1"),
					selectedWorkspaceId: workspaceId,
					workspaces: [
						{
							id: workspaceId,
							path: "/tmp/workspace",
							name: "workspace",
							lastOpenedAt: "2026-06-18T00:00:00.000Z",
							sortOrder: 0,
							missing: false,
							selected: true,
						},
					],
				},
			}),
		);
		unsubscribeSecond();

		expect(unsubscribeIpc).not.toHaveBeenCalled();
		expect(secondListener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot().workspaceCatalog.selectedWorkspaceId).toBe(workspaceId);
	});

	test("seeds initial errors from bootstrap warnings", () => {
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: () => () => undefined,
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
			{ initialError: "Failed to parse GUI catalog" },
		);

		expect(store.getSnapshot().error).toBe("Failed to parse GUI catalog");
	});

	test("mirrors composer drafts to main for synchronous extension getEditorText", () => {
		const invoke = vi.fn().mockResolvedValue({
			ok: true,
			requestId: requestIdFromString("request-1"),
			data: undefined,
		});
		const store = createGuiCatalogStore(
			{
				invoke,
				subscribe: () => () => undefined,
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);

		store.setComposerDraft(workspaceIdFromString("workspace-1"), sessionIdFromString("session-1"), "draft text");

		expect(invoke).toHaveBeenCalledWith(expect.any(ExtensionUiUpdateEditorText));
		expect(invoke.mock.calls[0]?.[0]).toMatchObject({
			_tag: "extensionUi.updateEditorText",
			workspaceId: "workspace-1",
			sessionId: "session-1",
			text: "draft text",
		});
	});

	test("applies extension UI request, editor text update, and resolution state immutably", () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const requestId = extensionUiRequestIdFromString("extension-ui-1");
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		const initialSnapshot = store.getSnapshot();

		listeners[0](
			new ExtensionUiRequested({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				request: {
					id: requestId,
					workspaceId,
					sessionId,
					kind: "input",
					title: "Name",
				},
			}),
		);
		listeners[0](
			new ExtensionUiUpdated({
				eventId: eventIdFromString("event-2"),
				sequence: 2,
				update: {
					workspaceId,
					sessionId,
					kind: "editorText",
					editorText: "from extension",
				},
			}),
		);

		const withRequest = store.getSnapshot();
		expect(withRequest).not.toBe(initialSnapshot);
		expect(withRequest.extensionUiBySessionKey["workspace-1:session-1"].requests).toHaveLength(1);
		expect(withRequest.composerDrafts["workspace-1:session-1"]).toBe("from extension");

		listeners[0](
			new ExtensionUiResolved({
				eventId: eventIdFromString("event-3"),
				sequence: 3,
				workspaceId,
				sessionId,
				extensionUiRequestId: requestId,
			}),
		);

		expect(store.getSnapshot().extensionUiBySessionKey["workspace-1:session-1"].requests).toHaveLength(0);
	});

	test("validates invoke results before applying renderer state", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const api = createValidatedRendererCatalogApi({
			invoke: vi.fn().mockResolvedValue({
				ok: true,
				requestId: "",
				data: {
					workspaceId,
					sessions: [],
				},
			}),
			subscribe: () => () => undefined,
		});

		const result = await api.invoke(
			new SessionCreate({
				requestId: requestIdFromString("request-1"),
				workspaceId,
			}),
		);

		expect(result).toMatchObject({
			ok: false,
			requestId: "request-1",
			error: {
				_tag: "InternalIpcError",
				message: "Invalid GUI command result",
				cause: expect.any(String),
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBeInstanceOf(InternalIpcError);
	});

	test("drops malformed event payloads before they reach the store", async () => {
		let eventListener: ((event: unknown) => void) | undefined;
		const listener = vi.fn();
		const api = createValidatedRendererCatalogApi({
			invoke: vi.fn(),
			subscribe: (nextListener) => {
				eventListener = nextListener;
				return () => undefined;
			},
		});
		api.subscribe(listener);

		eventListener?.({
			_tag: "workspace.catalogUpdated",
			eventId: "",
			sequence: 1,
			catalog: { revision: "1", workspaces: [] },
		});
		await Promise.resolve();

		expect(listener).not.toHaveBeenCalled();
	});
});
