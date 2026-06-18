import { describe, expect, test, vi } from "vitest";
import {
	SessionCancelFailed,
	SessionRuntimeNotFound,
	SessionRuntimeCloseFailed,
	SessionRunNotActive,
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	extensionUiRequestIdFromString,
	type GuiEvent,
	type SessionCatalogSnapshot,
	type TimelineSnapshot,
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
		getWorkspaceCatalog: vi.fn(() => Promise.resolve(workspaceCatalog)),
		openSession: vi.fn((workspaceId) => Promise.resolve(createSessionCatalog(workspaceId))),
	};
	const unsubscribe = vi.fn();
	let runtimeListener: ((event: unknown) => void) | undefined;
	let resolvePromptCompletion: (() => void) | undefined;
	let rejectPromptCompletion: ((error: unknown) => void) | undefined;
	const driver: SessionDriver = {
		openSession: vi.fn(async (request) => createHandle(request.workspaceId, request.workspacePath)),
		cancelRun: vi.fn(async () => undefined),
		closeSession: vi.fn(async () => undefined),
		getModelThinking: vi.fn(async (handle) => ({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			thinkingLevel: "off" as const,
			availableThinkingLevels: ["off" as const],
			models: [],
		})),
		getTranscript: vi.fn(
			async (handle): Promise<TimelineSnapshot> => ({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				entries: [{ id: "entry-1", kind: "user", text: "hello" }],
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
		}),
		unsubscribe,
	};
}

function createSessionCatalog(workspaceId: string): SessionCatalogSnapshot {
	return {
		workspaceId: workspaceIdFromString(workspaceId),
		selectedSessionId: sessionIdFromString("session-1"),
		sessions: [
			{
				id: sessionIdFromString("session-1"),
				workspaceId: workspaceIdFromString(workspaceId),
				title: "Session",
				status: "idle",
				updatedAt: "2026-06-18T00:00:00.000Z",
				preview: "",
				messageCount: 1,
				sessionFilePath: `/tmp/${workspaceId}/session-1.jsonl`,
			},
		],
	};
}

function createHandle(workspaceId: string, workspacePath: string): RuntimeSessionHandle {
	return {
		key: `${workspaceId}:session-1`,
		runtime: {
			session: {
				abort: vi.fn(async () => undefined),
				bindExtensions: vi.fn(),
				getAvailableThinkingLevels: vi.fn(() => ["off" as const]),
				thinkingLevel: "off" as const,
				setModel: vi.fn(async () => undefined),
				setThinkingLevel: vi.fn(),
				supportsThinking: vi.fn(() => false),
				prompt: vi.fn(async () => undefined),
				subscribe: vi.fn(() => vi.fn()),
			},
			dispose: vi.fn(),
		},
		sessionFilePath: `/tmp/${workspaceId}/session-1.jsonl`,
		sessionId: sessionIdFromString("session-1"),
		sessionManager: { getEntries: () => [], getSessionId: () => "session-1" },
		workspaceId: workspaceIdFromString(workspaceId),
		workspacePath,
	};
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
