import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
	AppBootstrap,
	SessionArchive,
	type SessionCatalogSnapshot,
	SessionCreate,
	SessionOpen,
	SessionRename,
	SessionUnarchive,
	type WorkspaceCatalogSnapshot,
	WorkspaceAdd,
	WorkspacePickDirectory,
	WorkspaceSync,
	requestIdFromString,
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

	test("returns CommandNotImplemented for non-bootstrap commands", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			{ _tag: "session.getTranscript", requestId: "request-1", sessionId: "session-1" },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("CommandNotImplemented");
			expect(result.error.message).toBe("session.getTranscript is not implemented in Phase 3");
		}
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

describe("Phase 3 catalog IPC commands", () => {
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
