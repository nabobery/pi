import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
	AppBootstrap,
	ExtensionUiUpdateEditorText,
	SessionCompact,
	SessionArchive,
	SessionCancelCompaction,
	type SessionCatalogSnapshot,
	SessionCancelRun,
	SessionCancelTreeNavigation,
	SessionClose,
	SessionCreate,
	SessionGetTranscript,
	SessionGetTree,
	SessionNavigateTree,
	SessionOpen,
	SessionRename,
	SessionRestoreQueuedMessages,
	SessionSendMessage,
	SessionSetTreeEntryLabel,
	SessionUnarchive,
	type SessionTreeSnapshot,
	type TimelineSnapshot,
	type WorkspaceCatalogSnapshot,
	WorkspaceAdd,
	WorkspacePickDirectory,
	WorkspaceSync,
	requestIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../src/contracts/index.ts";
import { createAppOriginPolicy, getPackagedRendererEntryUrl } from "../../src/main/app-origin-policy.ts";
import { CatalogService } from "../../src/main/catalog/catalog-service.ts";
import { JsonCatalogStore } from "../../src/main/catalog/json-catalog-store.ts";
import { createGuiInvokeHandler, RendererEventBus } from "../../src/main/ipc-router.ts";
import { PI_GUI_EVENT_CHANNEL } from "../../src/shared/contracts.ts";

const app = {
	getName: () => "Pi GUI",
	getVersion: () => "1.2.3",
};

const policy = createAppOriginPolicy({
	packagedRendererUrl: getPackagedRendererEntryUrl("/Applications/Pi.app/Contents/Resources/app.asar/dist/main"),
});

function createSender(id = 1) {
	return {
		id,
		isDestroyed: vi.fn(() => false),
		once: vi.fn(),
		send: vi.fn(),
	};
}

describe("createGuiInvokeHandler", () => {
	test("returns bootstrap data for trusted renderer senders", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(result).toEqual({
			ok: true,
			requestId: "request-1",
			data: {
				appInfo: {
					name: "Pi GUI",
					version: "1.2.3",
					mode: "test",
				},
				workspaceCatalog: {
					revision: "0",
					workspaces: [],
				},
			},
		});
	});

	test("rejects missing sender frames with renderer-safe errors", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });
		const sender = createSender();

		const result = await handler(
			{ senderFrame: null, sender },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.requestId).toBe("request-1");
			expect(result.error._tag).toBe("UnauthorizedIpcSender");
			expect(result.error.message).toBe("Blocked IPC from missing sender frame");
		}
		expect(sender.send).not.toHaveBeenCalled();
	});

	test("rejects untrusted renderer senders with renderer-safe errors", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });
		const sender = createSender();

		const result = await handler(
			{ senderFrame: { url: "file:///tmp/attacker.html" }, sender },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("UnauthorizedIpcSender");
			expect(result.error.message).toBe("Blocked IPC from untrusted renderer URL: file:///tmp/attacker.html");
		}
		expect(sender.send).not.toHaveBeenCalled();
	});

	test("maps malformed payloads to InvalidRendererCommand", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			{ _tag: "unknown.command", requestId: "request-1" },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.requestId).toBe("request-1");
			expect(result.error._tag).toBe("InvalidRendererCommand");
		}
	});

	test("returns CommandNotImplemented for deferred runtime mutation commands", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			new SessionCancelRun({
				requestId: requestIdFromString("request-1"),
				workspaceId: workspaceIdFromString("workspace-1"),
				sessionId: sessionIdFromString("session-1"),
			}),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("CommandNotImplemented");
			expect(result.error.message).toBe("session.cancelRun is not implemented");
		}
	});

	test("routes runtime session commands through the session supervisor", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const sessions: SessionCatalogSnapshot = {
			workspaceId,
			selectedSessionId: sessionId,
			sessions: [
				{
					id: sessionId,
					workspaceId,
					title: "Session",
					status: "ready",
					updatedAt: "2026-06-18T00:00:00.000Z",
					preview: "",
					messageCount: 1,
					sessionFilePath: "/tmp/session.jsonl",
				},
			],
		};
		const sessionSupervisor = {
			cancelRun: vi.fn(async () => undefined),
			cancelCompaction: vi.fn(async () => undefined),
			cancelTreeNavigation: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			compact: vi.fn(),
			createSession: vi.fn(async () => sessions),
			getModelThinking: vi.fn(),
			getTree: vi.fn(),
			getTranscript: vi.fn(
				async (): Promise<TimelineSnapshot> => ({
					workspaceId,
					sessionId,
					entries: [{ id: "entry-1", kind: "user", text: "hello" }],
				}),
			),
			openSession: vi.fn(async () => sessions),
			respondToExtensionUi: vi.fn(),
			restoreQueuedMessages: vi.fn(),
			navigateTree: vi.fn(),
			sendMessage: vi.fn(async () => undefined),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			setTreeEntryLabel: vi.fn(),
			updateExtensionEditorText: vi.fn(),
		};
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({
			app,
			eventBus,
			mode: "test",
			policy,
			sessionSupervisor,
		});
		const sender = createSender();

		const createResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionCreate({ requestId: requestIdFromString("request-1"), workspaceId }),
		);
		const transcriptResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionGetTranscript({ requestId: requestIdFromString("request-2"), workspaceId, sessionId }),
		);
		const closeResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionClose({ requestId: requestIdFromString("request-3"), workspaceId, sessionId }),
		);

		expect(createResult).toMatchObject({ ok: true, data: sessions });
		expect(transcriptResult).toMatchObject({
			ok: true,
			data: { workspaceId, sessionId, entries: [{ id: "entry-1", kind: "user", text: "hello" }] },
		});
		expect(closeResult).toMatchObject({ ok: true, data: undefined });
		expect(sessionSupervisor.createSession).toHaveBeenCalledWith(workspaceId);
		expect(sessionSupervisor.getTranscript).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(sessionSupervisor.closeSession).toHaveBeenCalledWith(workspaceId, sessionId);
	});

	test("routes tree and compaction commands through the supervisor", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const tree: SessionTreeSnapshot = {
			workspaceId,
			sessionId,
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
					isActiveLeaf: true,
					isActivePath: true,
					hasChildren: false,
					searchText: "user hello",
				},
			],
		};
		const timeline: TimelineSnapshot = { workspaceId, sessionId, entries: [] };
		const sessionSupervisor = {
			cancelRun: vi.fn(async () => undefined),
			cancelCompaction: vi.fn(async () => undefined),
			cancelTreeNavigation: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			compact: vi.fn(async () => ({
				workspaceId,
				sessionId,
				summary: "Compacted",
				tokensBefore: 1200,
				timeline,
				tree,
				cancelled: false,
			})),
			createSession: vi.fn(),
			getModelThinking: vi.fn(),
			getTree: vi.fn(async () => tree),
			getTranscript: vi.fn(),
			openSession: vi.fn(),
			navigateTree: vi.fn(async () => ({
				workspaceId,
				sessionId,
				tree,
				timeline,
				editorText: "hello",
				clearsComposer: false,
				cancelled: false,
			})),
			respondToExtensionUi: vi.fn(),
			restoreQueuedMessages: vi.fn(),
			sendMessage: vi.fn(async () => undefined),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			setTreeEntryLabel: vi.fn(async () => tree),
			updateExtensionEditorText: vi.fn(),
		};
		const handler = createGuiInvokeHandler({
			app,
			eventBus: new RendererEventBus(),
			mode: "test",
			policy,
			sessionSupervisor,
		});
		const sender = createSender();

		const getTreeResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionGetTree({ requestId: requestIdFromString("request-tree"), workspaceId, sessionId }),
		);
		const navigateResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionNavigateTree({
				requestId: requestIdFromString("request-tree-nav"),
				workspaceId,
				sessionId,
				targetEntryId: "entry-1",
				summaryMode: "none",
			}),
		);
		const labelResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionSetTreeEntryLabel({
				requestId: requestIdFromString("request-label"),
				workspaceId,
				sessionId,
				entryId: "entry-1",
				label: "checkpoint",
			}),
		);
		const compactResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionCompact({
				requestId: requestIdFromString("request-compact"),
				workspaceId,
				sessionId,
				customInstructions: "keep files",
			}),
		);
		const cancelCompactionResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionCancelCompaction({
				requestId: requestIdFromString("request-cancel-compact"),
				workspaceId,
				sessionId,
			}),
		);
		const cancelTreeNavigationResult = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionCancelTreeNavigation({
				requestId: requestIdFromString("request-cancel-tree"),
				workspaceId,
				sessionId,
			}),
		);

		expect(getTreeResult).toMatchObject({ ok: true, data: tree });
		expect(navigateResult).toMatchObject({ ok: true, data: expect.objectContaining({ editorText: "hello" }) });
		expect(labelResult).toMatchObject({ ok: true, data: tree });
		expect(compactResult).toMatchObject({ ok: true, data: expect.objectContaining({ summary: "Compacted" }) });
		expect(cancelCompactionResult).toMatchObject({ ok: true, data: undefined });
		expect(cancelTreeNavigationResult).toMatchObject({ ok: true, data: undefined });
		expect(sessionSupervisor.getTree).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(sessionSupervisor.navigateTree).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId, sessionId, targetEntryId: "entry-1", summaryMode: "none" }),
		);
		expect(sessionSupervisor.setTreeEntryLabel).toHaveBeenCalledWith(workspaceId, sessionId, "entry-1", "checkpoint");
		expect(sessionSupervisor.compact).toHaveBeenCalledWith(workspaceId, sessionId, "keep files");
		expect(sessionSupervisor.cancelCompaction).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(sessionSupervisor.cancelTreeNavigation).toHaveBeenCalledWith(workspaceId, sessionId);
	});

	test("emits app.error when session runtime context preload fails", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const sessions: SessionCatalogSnapshot = {
			workspaceId,
			selectedSessionId: sessionId,
			sessions: [
				{
					id: sessionId,
					workspaceId,
					title: "Session",
					status: "ready",
					updatedAt: "2026-06-18T00:00:00.000Z",
					preview: "",
					messageCount: 1,
					sessionFilePath: "/tmp/session.jsonl",
				},
			],
		};
		const sender = createSender();
		const handler = createGuiInvokeHandler({
			app,
			eventBus: new RendererEventBus(),
			mode: "test",
			policy,
			sessionSupervisor: {
				cancelRun: vi.fn(async () => undefined),
				closeSession: vi.fn(async () => undefined),
				createSession: vi.fn(async () => sessions),
				getModelThinking: vi.fn(),
				getTranscript: vi.fn(),
				openSession: vi.fn(async () => sessions),
				respondToExtensionUi: vi.fn(),
				restoreQueuedMessages: vi.fn(),
				sendMessage: vi.fn(async () => undefined),
				setModel: vi.fn(),
				setThinkingLevel: vi.fn(),
				updateExtensionEditorText: vi.fn(),
			},
			settingsBridgeService: {
				getSummary: vi.fn(async () => {
					throw new Error("settings unavailable");
				}),
				getTrustStatus: vi.fn(),
				openSettingsFile: vi.fn(),
				revealSettingsFile: vi.fn(),
			},
		});

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionCreate({ requestId: requestIdFromString("request-1"), workspaceId }),
		);

		expect(result).toMatchObject({ ok: true });
		expect(sender.send.mock.calls.map((call) => call[1])).toContainEqual(
			expect.objectContaining({
				_tag: "app.error",
				error: expect.objectContaining({ message: "Unhandled GUI IPC error", cause: "settings unavailable" }),
			}),
		);
	});

	test("routes prompt commands through the supervisor without generic preflight receipts", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const sessionSupervisor = {
			cancelRun: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			createSession: vi.fn(),
			getModelThinking: vi.fn(),
			getTranscript: vi.fn(),
			openSession: vi.fn(),
			respondToExtensionUi: vi.fn(),
			restoreQueuedMessages: vi.fn(),
			sendMessage: vi.fn(async () => undefined),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			updateExtensionEditorText: vi.fn(),
		};
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({
			app,
			eventBus,
			mode: "test",
			policy,
			sessionSupervisor,
		});
		const sender = createSender();

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new SessionSendMessage({
				requestId: requestIdFromString("request-1"),
				workspaceId,
				sessionId,
				message: "hello",
				deliveryMode: "steer",
			}),
		);

		expect(result).toEqual({ ok: true, requestId: "request-1", data: undefined });
		expect(sessionSupervisor.sendMessage).toHaveBeenCalledWith({
			requestId: "request-1",
			workspaceId,
			sessionId,
			message: "hello",
			deliveryMode: "steer",
		});
		expect(sender.send.mock.calls.map((call) => call[1])).toEqual([
			expect.objectContaining({ _tag: "receipt.emitted", receipt: "session.sendMessage.completed" }),
		]);
	});

	test("routes cancel commands through the supervisor", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const sessionSupervisor = {
			cancelRun: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			createSession: vi.fn(),
			getModelThinking: vi.fn(),
			getTranscript: vi.fn(),
			openSession: vi.fn(),
			respondToExtensionUi: vi.fn(),
			restoreQueuedMessages: vi.fn(),
			sendMessage: vi.fn(async () => undefined),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			updateExtensionEditorText: vi.fn(),
		};
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({
			app,
			eventBus,
			mode: "test",
			policy,
			sessionSupervisor,
		});

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			new SessionCancelRun({
				requestId: requestIdFromString("request-1"),
				workspaceId,
				sessionId,
			}),
		);

		expect(result).toEqual({ ok: true, requestId: "request-1", data: undefined });
		expect(sessionSupervisor.cancelRun).toHaveBeenCalledWith(workspaceId, sessionId);
	});

	test("routes queued message restore commands through the supervisor", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const restored = {
			workspaceId,
			sessionId,
			restoredMessages: [{ index: 0, kind: "steering" as const, text: "queued" }],
			queue: {
				workspaceId,
				sessionId,
				steeringMessages: [],
				followUpMessages: [],
				steeringCount: 0,
				followUpCount: 0,
				steeringMode: "all" as const,
				followUpMode: "all" as const,
			},
		};
		const sessionSupervisor = {
			cancelRun: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			createSession: vi.fn(),
			getModelThinking: vi.fn(),
			getTranscript: vi.fn(),
			openSession: vi.fn(),
			respondToExtensionUi: vi.fn(),
			restoreQueuedMessages: vi.fn(async () => restored),
			sendMessage: vi.fn(async () => undefined),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			updateExtensionEditorText: vi.fn(),
		};
		const handler = createGuiInvokeHandler({
			app,
			eventBus: new RendererEventBus(),
			mode: "test",
			policy,
			sessionSupervisor,
		});

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			new SessionRestoreQueuedMessages({
				requestId: requestIdFromString("request-1"),
				workspaceId,
				sessionId,
			}),
		);

		expect(result).toEqual({ ok: true, requestId: "request-1", data: restored });
		expect(sessionSupervisor.restoreQueuedMessages).toHaveBeenCalledWith(workspaceId, sessionId);
	});

	test("routes extension editor text mirror updates through the supervisor", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const sessionSupervisor = {
			cancelRun: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			createSession: vi.fn(),
			getModelThinking: vi.fn(),
			getTranscript: vi.fn(),
			openSession: vi.fn(),
			respondToExtensionUi: vi.fn(),
			restoreQueuedMessages: vi.fn(),
			sendMessage: vi.fn(async () => undefined),
			setModel: vi.fn(),
			setThinkingLevel: vi.fn(),
			updateExtensionEditorText: vi.fn(),
		};
		const handler = createGuiInvokeHandler({
			app,
			eventBus: new RendererEventBus(),
			mode: "test",
			policy,
			sessionSupervisor,
		});

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			new ExtensionUiUpdateEditorText({
				requestId: requestIdFromString("request-1"),
				workspaceId,
				sessionId,
				text: "draft",
			}),
		);

		expect(result).toEqual({ ok: true, requestId: "request-1", data: undefined });
		expect(sessionSupervisor.updateExtensionEditorText).toHaveBeenCalledWith(workspaceId, sessionId, "draft");
	});

	test("automatically emits bootstrap receipt events to trusted renderer senders", async () => {
		const sender = createSender();
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(sender.send).toHaveBeenCalledTimes(2);
		expect(sender.send.mock.calls.map((call) => call[0])).toEqual([PI_GUI_EVENT_CHANNEL, PI_GUI_EVENT_CHANNEL]);
		expect(sender.send.mock.calls.map((call) => call[1])).toEqual([
			expect.objectContaining({ _tag: "receipt.emitted", sequence: 1, receipt: "app.bootstrap.accepted" }),
			expect.objectContaining({ _tag: "receipt.emitted", sequence: 2, receipt: "app.bootstrap.completed" }),
		]);
		expect(sender.once).toHaveBeenCalledWith("destroyed", expect.any(Function));
	});

	test("returns malformed catalog recovery as a bootstrap warning", async () => {
		const fixture = await createCatalogFixture();
		try {
			await writeFile(fixture.catalogPath, "{not-json", "utf8");
			const sender = createSender();
			const eventBus = new RendererEventBus();
			const handler = createGuiInvokeHandler({
				app,
				catalogService: fixture.service,
				eventBus,
				mode: "test",
				policy,
			});

			const result = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new AppBootstrap({ requestId: requestIdFromString("request-1") }),
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toMatchObject({
					warnings: [expect.objectContaining({ _tag: "CatalogParseFailed" })],
				});
			}
			expect(sender.send.mock.calls.map((call) => call[1]._tag)).toEqual(["receipt.emitted", "receipt.emitted"]);
		} finally {
			await fixture.dispose();
		}
	});
});

describe("RendererEventBus", () => {
	test("removes senders when web contents are destroyed", () => {
		const eventBus = new RendererEventBus();
		const sender = createSender();

		eventBus.registerSender(sender);
		eventBus.publishReceipt("request-1", "app.bootstrap.accepted");
		const destroyHandler = sender.once.mock.calls[0]?.[1] as (() => void) | undefined;
		destroyHandler?.();
		eventBus.publishReceipt("request-1", "app.bootstrap.completed");

		expect(sender.send).toHaveBeenCalledTimes(1);
	});
});

describe("catalog IPC commands", () => {
	test("workspace.add returns a catalog and emits workspace/session catalog events", async () => {
		const fixture = await createCatalogFixture();
		try {
			const sender = createSender();
			const eventBus = new RendererEventBus();
			const handler = createGuiInvokeHandler({
				app,
				catalogService: fixture.service,
				eventBus,
				mode: "test",
				policy,
			});

			const result = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new WorkspaceAdd({ requestId: requestIdFromString("request-1"), path: fixture.workspaceDir }),
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data).toMatchObject({
					workspaces: [expect.objectContaining({ name: "workspace", selected: true })],
				});
			}
			expect(sender.send.mock.calls.map((call) => call[1]._tag)).toEqual([
				"receipt.emitted",
				"workspace.catalogUpdated",
				"session.catalogUpdated",
				"workspace.synced",
				"receipt.emitted",
			]);
		} finally {
			await fixture.dispose();
		}
	});

	test("workspace.pickDirectory cancel returns the current catalog without mutation", async () => {
		const fixture = await createCatalogFixture();
		try {
			const handler = createGuiInvokeHandler({
				app,
				catalogService: fixture.service,
				eventBus: new RendererEventBus(),
				mode: "test",
				pickWorkspaceDirectory: async () => undefined,
				policy,
			});

			const result = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
				new WorkspacePickDirectory({ requestId: requestIdFromString("request-1") }),
			);

			expect(result).toMatchObject({
				ok: true,
				data: {
					revision: "0",
					workspaces: [],
				},
			});
		} finally {
			await fixture.dispose();
		}
	});

	test("session.create, session.rename, and session.archive update catalog state and session files", async () => {
		const fixture = await createCatalogFixture();
		try {
			const sender = createSender();
			const eventBus = new RendererEventBus();
			const handler = createGuiInvokeHandler({
				app,
				catalogService: fixture.service,
				eventBus,
				mode: "test",
				policy,
			});
			const workspaceResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new WorkspaceAdd({ requestId: requestIdFromString("request-1"), path: fixture.workspaceDir }),
			);
			expect(workspaceResult.ok).toBe(true);
			if (!workspaceResult.ok) return;
			const workspaceData = workspaceResult.data as WorkspaceCatalogSnapshot;
			const workspaceId = workspaceData.workspaces[0].id;

			const createResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new SessionCreate({ requestId: requestIdFromString("request-2"), workspaceId }),
			);
			expect(createResult.ok).toBe(true);
			if (!createResult.ok) return;
			const createData = createResult.data as SessionCatalogSnapshot;
			const session = createData.sessions[0];
			expect(session.sessionFilePath).toBeDefined();

			const renameResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new SessionRename({
					requestId: requestIdFromString("request-3"),
					workspaceId,
					sessionId: session.id,
					title: "Renamed from IPC",
				}),
			);
			expect(renameResult.ok).toBe(true);
			expect(await readFile(session.sessionFilePath!, "utf8")).toContain('"name":"Renamed from IPC"');

			const archiveResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new SessionArchive({ requestId: requestIdFromString("request-4"), workspaceId, sessionId: session.id }),
			);
			expect(archiveResult).toMatchObject({
				ok: true,
				data: {
					sessions: [expect.objectContaining({ archivedAt: expect.any(String) })],
				},
			});

			const unarchiveResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new SessionUnarchive({ requestId: requestIdFromString("request-5"), workspaceId, sessionId: session.id }),
			);
			expect(unarchiveResult).toMatchObject({
				ok: true,
				data: {
					sessions: [expect.not.objectContaining({ archivedAt: expect.any(String) })],
				},
			});
		} finally {
			await fixture.dispose();
		}
	});

	test("session.open requires workspace-scoped identity and selects without runtime creation", async () => {
		const fixture = await createCatalogFixture();
		try {
			const sender = createSender();
			const eventBus = new RendererEventBus();
			const handler = createGuiInvokeHandler({
				app,
				catalogService: fixture.service,
				eventBus,
				mode: "test",
				policy,
			});
			const workspaceResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new WorkspaceAdd({ requestId: requestIdFromString("request-1"), path: fixture.workspaceDir }),
			);
			expect(workspaceResult.ok).toBe(true);
			if (!workspaceResult.ok) return;
			const workspaceData = workspaceResult.data as WorkspaceCatalogSnapshot;
			const workspaceId = workspaceData.workspaces[0].id;
			const createResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new SessionCreate({ requestId: requestIdFromString("request-2"), workspaceId }),
			);
			expect(createResult.ok).toBe(true);
			if (!createResult.ok) return;
			const createData = createResult.data as SessionCatalogSnapshot;
			const sessionId = createData.sessions[0].id;

			const result = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new SessionOpen({ requestId: requestIdFromString("request-3"), workspaceId, sessionId }),
			);

			expect(result).toMatchObject({
				ok: true,
				data: {
					workspaceId,
					selectedSessionId: sessionId,
				},
			});
		} finally {
			await fixture.dispose();
		}
	});

	test("workspace.sync missing path emits recoverable catalog update before failure", async () => {
		const fixture = await createCatalogFixture();
		try {
			const sender = createSender();
			const eventBus = new RendererEventBus();
			const handler = createGuiInvokeHandler({
				app,
				catalogService: fixture.service,
				eventBus,
				mode: "test",
				policy,
			});
			const workspaceResult = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new WorkspaceAdd({ requestId: requestIdFromString("request-1"), path: fixture.workspaceDir }),
			);
			expect(workspaceResult.ok).toBe(true);
			if (!workspaceResult.ok) return;
			const workspaceData = workspaceResult.data as WorkspaceCatalogSnapshot;
			const workspaceId = workspaceData.workspaces[0].id;
			await rm(fixture.workspaceDir, { recursive: true, force: true });

			const result = await handler(
				{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
				new WorkspaceSync({ requestId: requestIdFromString("request-2"), workspaceId }),
			);

			expect(result).toMatchObject({
				ok: false,
				error: {
					_tag: "WorkspacePathMissing",
				},
			});
			expect(sender.send.mock.calls.map((call) => call[1]._tag)).toContain("workspace.catalogUpdated");
			const workspaceEvents = sender.send.mock.calls
				.map((call) => call[1])
				.filter((event) => event._tag === "workspace.catalogUpdated");
			expect(workspaceEvents.at(-1)?.catalog.workspaces[0].missing).toBe(true);
		} finally {
			await fixture.dispose();
		}
	});
});

async function createCatalogFixture() {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-gui-ipc-"));
	const workspaceDir = join(tempDir, "workspace");
	const sessionDir = join(tempDir, "sessions");
	await mkdir(workspaceDir, { recursive: true });
	await mkdir(sessionDir, { recursive: true });
	const service = new CatalogService({
		sessionDir,
		store: new JsonCatalogStore({ catalogPath: join(tempDir, "catalog.json") }),
	});
	return {
		catalogPath: join(tempDir, "catalog.json"),
		service,
		workspaceDir,
		dispose: () => rm(tempDir, { recursive: true, force: true }),
	};
}
