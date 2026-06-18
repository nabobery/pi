import { describe, expect, test } from "vitest";
import {
	AppBootstrap,
	AppReady,
	BootstrapSnapshot,
	CatalogParseFailed,
	CommandNotImplemented,
	InvalidWorkspacePath,
	GuiCommand,
	GuiError,
	GuiEvent,
	ReceiptEmitted,
	RunCancelled,
	RunCompleted,
	SessionCancelFailed,
	SessionArchive,
	SessionCatalogSnapshot,
	SessionClose,
	SessionClosed,
	SessionGetTranscript,
	SessionPromptFailed,
	SessionPromptRejected,
	SessionRuntimeNotFound,
	SessionRunNotActive,
	SessionSendMessage,
	SessionRename,
	SessionSelected,
	TimelineSnapshot,
	TimelineMessageDelta,
	WorkspacePickDirectory,
	WorkspaceRemove,
	WorkspaceSynced,
	decodeGuiCommand,
	decodeGuiError,
	decodeGuiEvent,
	decodeTimelineSnapshot,
	eventIdFromString,
	requestIdFromString,
	runIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../src/contracts/index.ts";

describe("gui contracts", () => {
	test("decodes valid commands", async () => {
		const command = await decodeGuiCommand(new AppBootstrap({ requestId: requestIdFromString("request-1") }));

		expect(command).toBeInstanceOf(AppBootstrap);
		expect(command.requestId).toBe("request-1");
	});

	test("decodes phase 3 workspace and session commands", async () => {
		await expect(
			decodeGuiCommand(new WorkspacePickDirectory({ requestId: requestIdFromString("request-2") })),
		).resolves.toBeInstanceOf(WorkspacePickDirectory);
		await expect(
			decodeGuiCommand(
				new WorkspaceRemove({
					requestId: requestIdFromString("request-3"),
					workspaceId: workspaceIdFromString("workspace-1"),
				}),
			),
		).resolves.toBeInstanceOf(WorkspaceRemove);
		await expect(
			decodeGuiCommand(
				new SessionRename({
					requestId: requestIdFromString("request-4"),
					workspaceId: workspaceIdFromString("workspace-1"),
					sessionId: sessionIdFromString("session-1"),
					title: "Renamed",
				}),
			),
		).resolves.toBeInstanceOf(SessionRename);
		await expect(
			decodeGuiCommand(
				new SessionArchive({
					requestId: requestIdFromString("request-5"),
					workspaceId: workspaceIdFromString("workspace-1"),
					sessionId: sessionIdFromString("session-1"),
				}),
			),
		).resolves.toBeInstanceOf(SessionArchive);
	});

	test("decodes runtime-scoped session commands with workspace identity", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			decodeGuiCommand(new SessionClose({ requestId: requestIdFromString("request-6"), workspaceId, sessionId })),
		).resolves.toBeInstanceOf(SessionClose);
		await expect(
			decodeGuiCommand(
				new SessionGetTranscript({ requestId: requestIdFromString("request-7"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(SessionGetTranscript);
		await expect(decodeGuiCommand({ _tag: "session.close", requestId: "request-8", sessionId })).rejects.toThrow();
	});

	test("decodes prompt commands with explicit running delivery modes", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		const idleCommand = await decodeGuiCommand(
			new SessionSendMessage({
				requestId: requestIdFromString("request-9"),
				workspaceId,
				sessionId,
				message: "hello",
			}),
		);
		const runningCommand = await decodeGuiCommand(
			new SessionSendMessage({
				requestId: requestIdFromString("request-10"),
				workspaceId,
				sessionId,
				message: "adjust",
				deliveryMode: "steer",
			}),
		);

		expect(idleCommand).toBeInstanceOf(SessionSendMessage);
		expect(runningCommand).toMatchObject({ deliveryMode: "steer" });
		await expect(
			decodeGuiCommand({
				_tag: "session.sendMessage",
				requestId: "request-11",
				workspaceId,
				sessionId,
				message: "bad",
				deliveryMode: "now",
			}),
		).rejects.toThrow();
	});

	test("rejects commands with unknown tags", async () => {
		await expect(decodeGuiCommand({ _tag: "unknown.command", requestId: "request-1" })).rejects.toThrow();
	});

	test("rejects commands with missing required payload fields", async () => {
		await expect(decodeGuiCommand({ _tag: "workspace.select", requestId: "request-1" })).rejects.toThrow();
	});

	test("rejects invalid branded IDs", async () => {
		await expect(
			decodeGuiCommand({ _tag: "workspace.select", requestId: "request-1", workspaceId: "" }),
		).rejects.toThrow();
	});

	test("creates branded IDs from valid strings", () => {
		expect(workspaceIdFromString("workspace-1")).toBe("workspace-1");
	});

	test("decodes events", async () => {
		const event = await decodeGuiEvent(
			new ReceiptEmitted({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				receipt: "app.bootstrap.completed",
				requestId: requestIdFromString("request-1"),
			}),
		);

		expect(event).toBeInstanceOf(ReceiptEmitted);
		expect(event.sequence).toBe(1);
	});

	test("decodes phase 3 catalog events", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		await expect(
			decodeGuiEvent(
				new WorkspaceSynced({
					eventId: eventIdFromString("event-2"),
					sequence: 2,
					workspaceId,
					sessions: {
						workspaceId,
						selectedSessionId: sessionId,
						sessions: [],
					},
				}),
			),
		).resolves.toBeInstanceOf(WorkspaceSynced);
		await expect(
			decodeGuiEvent(
				new SessionSelected({
					eventId: eventIdFromString("event-3"),
					sequence: 3,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(SessionSelected);
		await expect(
			decodeGuiEvent(
				new SessionClosed({
					eventId: eventIdFromString("event-4"),
					sequence: 4,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(SessionClosed);
	});

	test("decodes workspace-scoped prompt runtime events", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const runId = runIdFromString("run-1");

		await expect(
			decodeGuiEvent(
				new TimelineMessageDelta({
					eventId: eventIdFromString("event-5"),
					sequence: 5,
					workspaceId,
					runId,
					sessionId,
					text: "hello",
				}),
			),
		).resolves.toBeInstanceOf(TimelineMessageDelta);
		await expect(
			decodeGuiEvent(
				new RunCompleted({
					eventId: eventIdFromString("event-6"),
					sequence: 6,
					runId,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(RunCompleted);
		await expect(
			decodeGuiEvent(
				new RunCancelled({
					eventId: eventIdFromString("event-7"),
					sequence: 7,
					runId,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(RunCancelled);
		await expect(
			decodeGuiEvent({
				_tag: "timeline.messageDelta",
				eventId: "event-8",
				sequence: 8,
				sessionId,
				text: "missing workspace",
			}),
		).rejects.toThrow();
	});

	test("decodes error serialization", async () => {
		const error = await decodeGuiError(
			new CommandNotImplemented({
				commandTag: "session.open",
				message: "Command is not implemented in Phase 2",
			}),
		);

		expect(error).toBeInstanceOf(CommandNotImplemented);
		expect(error._tag).toBe("CommandNotImplemented");
	});

	test("decodes phase 3 catalog errors", async () => {
		const error = await decodeGuiError(
			new InvalidWorkspacePath({
				path: "/missing/project",
				message: "Workspace path does not exist",
			}),
		);

		expect(error).toBeInstanceOf(InvalidWorkspacePath);
		expect(error._tag).toBe("InvalidWorkspacePath");
	});

	test("decodes phase 4 runtime errors", async () => {
		const error = await decodeGuiError(
			new SessionRuntimeNotFound({
				workspaceId: "workspace-1",
				sessionId: "session-1",
				message: "Runtime is not open",
			}),
		);

		expect(error).toBeInstanceOf(SessionRuntimeNotFound);
		expect(error._tag).toBe("SessionRuntimeNotFound");
	});

	test("decodes phase 5 prompt errors", async () => {
		await expect(
			decodeGuiError(
				new SessionPromptRejected({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					message: "Prompt rejected",
				}),
			),
		).resolves.toBeInstanceOf(SessionPromptRejected);
		await expect(
			decodeGuiError(
				new SessionPromptFailed({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					runId: "run-1",
					message: "Prompt failed",
				}),
			),
		).resolves.toBeInstanceOf(SessionPromptFailed);
		await expect(
			decodeGuiError(
				new SessionCancelFailed({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					runId: "run-1",
					message: "Cancel failed",
				}),
			),
		).resolves.toBeInstanceOf(SessionCancelFailed);
		await expect(
			decodeGuiError(
				new SessionRunNotActive({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					message: "No active run",
				}),
			),
		).resolves.toBeInstanceOf(SessionRunNotActive);
	});

	test("decodes session catalog snapshots", () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		expect(
			SessionCatalogSnapshot.make({
				workspaceId,
				selectedSessionId: sessionId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session one",
						status: "cancelling",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "Preview",
						messageCount: 2,
						sessionFilePath: "/tmp/session.jsonl",
					},
				],
			}),
		).toMatchObject({ workspaceId, selectedSessionId: sessionId });
	});

	test("decodes timeline snapshots with workspace identity", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		expect(
			TimelineSnapshot.make({
				workspaceId,
				sessionId,
				entries: [{ id: "entry-1", kind: "user", text: "hello" }],
			}),
		).toEqual({
			workspaceId,
			sessionId,
			entries: [{ id: "entry-1", kind: "user", text: "hello" }],
		});
		await expect(
			decodeTimelineSnapshot({
				sessionId,
				entries: [],
			}),
		).rejects.toThrow();
	});

	test("decodes bootstrap snapshots with warnings", () => {
		expect(
			BootstrapSnapshot.make({
				appInfo: {
					name: "Pi GUI",
					version: "1.2.3",
					mode: "test",
				},
				warnings: [
					new CatalogParseFailed({
						message: "Failed to parse GUI catalog",
						backupPath: "/tmp/catalog.invalid",
					}),
				],
			}),
		).toMatchObject({
			warnings: [expect.objectContaining({ _tag: "CatalogParseFailed" })],
		});
	});

	test("exports command, event, and error union schemas", () => {
		expect(GuiCommand).toBeDefined();
		expect(GuiEvent).toBeDefined();
		expect(GuiError).toBeDefined();
		expect(AppReady).toBeDefined();
	});
});
