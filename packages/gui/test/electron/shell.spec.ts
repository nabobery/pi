import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FAKE_RUNTIME_PROMPTS, PI_GUI_FAKE_DRIVER_ENV } from "../../src/main/session/fake-session-driver.ts";
import type { GuiCommand, GuiCommandResult, GuiEvent } from "../../src/contracts/index.ts";

const waitTimeoutMs = 5_000;

test("launches the secure Pi GUI shell", async () => {
	const fixture = await launchFixture();
	try {
		await expect(fixture.page.getByRole("heading", { name: "Pi" })).toBeVisible();
		await expect(fixture.page.getByTestId("composer-input")).toBeVisible();

		const bootstrapResult = await invokeAndWait(fixture.page, command("app.bootstrap", "bootstrap-1"), {
			receipts: ["app.bootstrap.accepted", "app.bootstrap.completed"],
		});
		expect(bootstrapResult.result.ok).toBe(true);
		if (!bootstrapResult.result.ok) throw new Error("Expected bootstrap to succeed");

		const bootstrapData = bootstrapResult.result.data as { appInfo: { name: string; version: string } };
		expect(bootstrapData.appInfo.name).toBeTruthy();
		expect(bootstrapData.appInfo.version).toMatch(/^\d+\.\d+\.\d+/);

		const rendererGlobals = await fixture.page.evaluate(() => ({
			hasPiGui: "piGui" in window,
			hasProcess: "process" in window,
			hasRequire: "require" in window,
			hasIpcRenderer: "ipcRenderer" in window,
			hasElectronAPI: "electronAPI" in window,
			piGuiKeys: Object.keys(window.piGui),
		}));

		expect(rendererGlobals).toEqual({
			hasPiGui: true,
			hasProcess: false,
			hasRequire: false,
			hasIpcRenderer: false,
			hasElectronAPI: false,
			piGuiKeys: ["invoke", "subscribe"],
		});
		expectDiagnosticsClean(fixture);
	} finally {
		await fixture.cleanup();
	}
});

test("manages workspace/session lifecycle, restores selection, and runs fake prompts", async () => {
	const fixture = await launchFixture();
	try {
		await invokeAndWait(fixture.page, command("app.bootstrap", "lifecycle-bootstrap"), {
			receipts: ["app.bootstrap.completed"],
		});

		const add = await invokeAndWait(
			fixture.page,
			command("workspace.add", "workspace-add", { path: fixture.workspacePath }),
			{ receipts: ["workspace.add.accepted", "workspace.add.completed"], eventTags: ["workspace.catalogUpdated"] },
		);
		expect(add.result.ok).toBe(true);
		if (!add.result.ok) throw new Error("Expected workspace add to succeed");
		const workspaceCatalog = add.result.data as { selectedWorkspaceId: string };
		const workspaceId = workspaceCatalog.selectedWorkspaceId;
		expect(workspaceId).toBeTruthy();

		const sync = await invokeAndWait(fixture.page, command("workspace.sync", "workspace-sync", { workspaceId }), {
			receipts: ["workspace.sync.accepted", "workspace.sync.completed"],
			eventTags: ["session.catalogUpdated"],
		});
		expect(sync.result.ok).toBe(true);

		const created = await invokeAndWait(fixture.page, command("session.create", "session-create", { workspaceId }), {
			receipts: ["session.create.accepted", "session.create.completed"],
			eventTags: ["session.catalogUpdated", "session.selected"],
		});
		expect(created.result.ok).toBe(true);
		if (!created.result.ok) throw new Error("Expected session create to succeed");
		const sessionCatalog = created.result.data as { selectedSessionId: string; sessions: Array<{ id: string }> };
		const sessionId = sessionCatalog.selectedSessionId;
		expect(sessionCatalog.sessions.map((session) => session.id)).toContain(sessionId);

		const closedBeforeOpen = await invokeAndWait(
			fixture.page,
			command("session.close", "session-close-before-open", { workspaceId, sessionId }),
			{ receipts: ["session.close.accepted", "session.close.completed"], eventTags: ["session.closed"] },
		);
		expect(closedBeforeOpen.result.ok).toBe(true);

		const opened = await invokeAndWait(
			fixture.page,
			command("session.open", "session-open", { workspaceId, sessionId }),
			{
				receipts: ["session.open.accepted", "session.open.completed"],
				eventTags: ["session.selected", "session.opened"],
			},
		);
		expect(opened.result.ok).toBe(true);

		const restarted = await restartFixture(fixture);
		const restored = await invokeAndWait(restarted.page, command("app.bootstrap", "restore-bootstrap"), {
			receipts: ["app.bootstrap.completed"],
		});
		expect(restored.result.ok).toBe(true);
		if (!restored.result.ok) throw new Error("Expected restore bootstrap to succeed");
		const restoredData = restored.result.data as {
			workspaceCatalog: { selectedWorkspaceId: string; workspaces: Array<{ id: string }> };
		};
		expect(restoredData.workspaceCatalog.selectedWorkspaceId).toBe(workspaceId);
		expect(restoredData.workspaceCatalog.workspaces.map((workspace) => workspace.id)).toContain(workspaceId);

		const reopened = await invokeAndWait(
			restarted.page,
			command("session.open", "restore-session-open", { workspaceId, sessionId }),
			{
				receipts: ["session.open.accepted", "session.open.completed"],
				eventTags: ["session.selected", "session.opened"],
			},
		);
		expect(reopened.result.ok).toBe(true);

		const run = await invokeAndWait(
			restarted.page,
			command("session.sendMessage", "session-send", {
				workspaceId,
				sessionId,
				message: "hello fake runtime",
			}),
			{
				receipts: ["session.sendMessage.accepted", "session.sendMessage.completed"],
				eventTags: [
					"run.started",
					"timeline.messageDelta",
					"tool.started",
					"tool.updated",
					"tool.finished",
					"run.completed",
				],
			},
		);
		expect(run.result.ok).toBe(true);
		expect(run.events.map((event) => event._tag)).toContain("timeline.messageDelta");

		const cancelStarted = waitForEvents(restarted.page, ["session.statusChanged", "run.started"]);
		const cancelSend = await restarted.page.evaluate(
			(commandPayload) => window.piGui.invoke(commandPayload as GuiCommand),
			command("session.sendMessage", "session-delay", {
				workspaceId,
				sessionId,
				message: FAKE_RUNTIME_PROMPTS.delay,
			}),
		);
		expect(cancelSend.ok).toBe(true);
		await cancelStarted;
		const cancel = await invokeAndWait(
			restarted.page,
			command("session.cancelRun", "session-cancel", { workspaceId, sessionId }),
			{ receipts: ["session.cancelRun.completed"], eventTags: ["run.cancelled"] },
		);
		expect(cancel.result.ok).toBe(true);
		expectDiagnosticsClean(restarted);
	} finally {
		await fixture.cleanup();
	}
});

test("renders and resolves fake extension UI requests", async () => {
	const fixture = await launchFixture();
	try {
		const { workspaceId, sessionId } = await createOpenSession(fixture.page, fixture.workspacePath);

		const requested = waitForMatchingEvent(fixture.page, "extensionUi.requested");
		const send = await fixture.page.evaluate(
			(commandPayload) => window.piGui.invoke(commandPayload as GuiCommand),
			command("session.sendMessage", "extension-send", {
				workspaceId,
				sessionId,
				message: FAKE_RUNTIME_PROMPTS.confirm,
			}),
		);
		expect(send.ok).toBe(true);
		const requestEvent = (await requested) as { _tag: "extensionUi.requested"; request: { id: string } };
		await expect(fixture.page.getByRole("dialog")).toBeVisible();
		const resolvedEvent = waitForMatchingEvent(fixture.page, "extensionUi.resolved");
		await fixture.page.getByRole("button", { name: "Confirm" }).click();
		const resolved = await resolvedEvent;
		expect((resolved as { extensionUiRequestId: string }).extensionUiRequestId).toBe(requestEvent.request.id);
		expectDiagnosticsClean(fixture);
	} finally {
		await fixture.cleanup();
	}
});

test("rejects malformed commands and recovers from invalid catalog files", async () => {
	const fixture = await launchFixture({ invalidCatalog: true });
	try {
		const bootstrap = await invokeAndWait(fixture.page, command("app.bootstrap", "invalid-catalog-bootstrap"), {
			receipts: ["app.bootstrap.completed"],
		});
		expect(bootstrap.result.ok).toBe(true);
		if (!bootstrap.result.ok) throw new Error("Expected invalid catalog bootstrap to recover");
		const data = bootstrap.result.data as { warnings?: Array<{ _tag: string; backupPath?: string }> };
		expect(data.warnings?.[0]?._tag).toBe("CatalogParseFailed");
		expect(data.warnings?.[0]?.backupPath).toContain(".invalid");

		const invalid = await fixture.page.evaluate(() =>
			window.piGui.invoke({ _tag: "workspace.add", requestId: "bad-command", path: 123 } as unknown as GuiCommand),
		);
		expect(invalid.ok).toBe(false);
		if (invalid.ok) throw new Error("Expected malformed command to fail");
		expect(invalid.error._tag).toBe("InvalidRendererCommand");
		expectDiagnosticsClean(fixture);
	} finally {
		await fixture.cleanup();
	}
});

interface ElectronFixture {
	app: ElectronApplication;
	homePath: string;
	mainErrors: string[];
	page: Page;
	processErrors: string[];
	rendererErrors: string[];
	workspacePath: string;
	cleanup(): Promise<void>;
}

async function launchFixture(
	options: { homePath?: string; invalidCatalog?: boolean; workspacePath?: string } = {},
): Promise<ElectronFixture> {
	const homePath = options.homePath ?? join(tmpdir(), `pi-gui-home-${crypto.randomUUID()}`);
	const workspacePath = options.workspacePath ?? join(tmpdir(), `pi-gui-workspace-${crypto.randomUUID()}`);
	await mkdir(workspacePath, { recursive: true });
	if (options.invalidCatalog) {
		await mkdir(join(homePath, ".pi", "gui"), { recursive: true });
		await writeFile(join(homePath, ".pi", "gui", "catalog.json"), "{ invalid catalog", "utf8");
	}
	const mainErrors: string[] = [];
	const processErrors: string[] = [];
	const rendererErrors: string[] = [];
	const appPath = join(import.meta.dirname, "../..");
	const env = { ...process.env };
	delete env.FORCE_COLOR;
	let app: ElectronApplication;
	try {
		app = await electron.launch({
			args: [appPath],
			timeout: 10_000,
			cwd: appPath,
			env: {
				...env,
				ELECTRON_ENABLE_LOGGING: "1",
				HOME: homePath,
				NO_COLOR: "1",
				NODE_ENV: "test",
				[PI_GUI_FAKE_DRIVER_ENV]: "1",
			},
		});
	} catch (error) {
		throw new Error(
			`Electron failed to launch from ${appPath}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	app.process().once("exit", (code, signal) => {
		processErrors.push(`main process exited with code ${code ?? "null"} and signal ${signal ?? "null"}`);
	});
	app.on("console", (message) => {
		if (message.type() === "error") mainErrors.push(message.text());
	});
	const page = await app.firstWindow({ timeout: 10_000 });
	page.on("console", (message) => {
		if (message.type() === "error") rendererErrors.push(message.text());
	});
	page.on("pageerror", (error) => {
		rendererErrors.push(error.message);
	});
	await page.waitForURL((url) => url.protocol === "file:" || url.origin === "http://localhost:5173");
	await page.waitForLoadState("domcontentloaded");

	return {
		app,
		homePath,
		mainErrors,
		page,
		processErrors,
		rendererErrors,
		workspacePath,
		cleanup: async () => {
			await app.close().catch(() => undefined);
			await rm(homePath, { recursive: true, force: true });
			await rm(workspacePath, { recursive: true, force: true });
		},
	};
}

async function restartFixture(fixture: ElectronFixture): Promise<ElectronFixture> {
	await fixture.app.close();
	const restarted = await launchFixture({ homePath: fixture.homePath, workspacePath: fixture.workspacePath });
	fixture.app = restarted.app;
	fixture.page = restarted.page;
	fixture.mainErrors = restarted.mainErrors;
	fixture.processErrors = restarted.processErrors;
	fixture.rendererErrors = restarted.rendererErrors;
	return fixture;
}

async function createOpenSession(
	page: Page,
	workspacePath: string,
): Promise<{ workspaceId: string; sessionId: string }> {
	const added = await invokeAndWait(
		page,
		command("workspace.add", "extension-workspace-add", { path: workspacePath }),
		{
			receipts: ["workspace.add.completed"],
		},
	);
	if (!added.result.ok) throw new Error("Expected workspace add to succeed");
	const workspaceId = (added.result.data as { selectedWorkspaceId: string }).selectedWorkspaceId;
	const created = await invokeAndWait(page, command("session.create", "extension-session-create", { workspaceId }), {
		receipts: ["session.create.completed"],
		eventTags: ["session.selected", "session.opened"],
	});
	if (!created.result.ok) throw new Error("Expected session create to succeed");
	const sessionId = (created.result.data as { selectedSessionId: string }).selectedSessionId;
	return { workspaceId, sessionId };
}

function command(_tag: string, requestId: string, payload: Record<string, unknown> = {}): GuiCommand {
	return { _tag, requestId, ...payload } as unknown as GuiCommand;
}

function expectDiagnosticsClean(fixture: ElectronFixture): void {
	expect(fixture.mainErrors).toEqual([]);
	expect(fixture.rendererErrors).toEqual([]);
	expect(fixture.processErrors).toEqual([]);
}

async function invokeAndWait(
	page: Page,
	commandPayload: GuiCommand,
	expected: { receipts?: readonly string[]; eventTags?: readonly string[] },
): Promise<{ events: GuiEvent[]; receipts: string[]; result: GuiCommandResult }> {
	return page.evaluate(
		async ({ commandToInvoke, expectedReceipts, expectedEventTags, waitMs }) => {
			const events: GuiEvent[] = [];
			const receipts: string[] = [];
			let result: GuiCommandResult | undefined;
			return new Promise<{ events: GuiEvent[]; receipts: string[]; result: GuiCommandResult }>((resolve, reject) => {
				let unsubscribe: () => void = () => undefined;
				const timeout = window.setTimeout(() => {
					unsubscribe();
					reject(
						new Error(
							`Timed out waiting for receipts ${expectedReceipts.join(",")} and events ${expectedEventTags.join(",")}; observed receipts ${receipts.join(",")}; observed events ${events.map((event) => event._tag).join(",")}`,
						),
					);
				}, waitMs);
				const finish = (value: { events: GuiEvent[]; receipts: string[]; result: GuiCommandResult }) => {
					window.clearTimeout(timeout);
					unsubscribe();
					resolve(value);
				};
				const done = () => {
					if (!result) return;
					if (!expectedReceipts.every((receipt) => receipts.includes(receipt))) return;
					if (!expectedEventTags.every((tag) => events.some((event) => event._tag === tag))) return;
					finish({ events, receipts, result });
				};
				unsubscribe = window.piGui.subscribe((event) => {
					events.push(event);
					if (event._tag === "receipt.emitted") receipts.push(event.receipt);
					done();
				});
				void window.piGui.invoke(commandToInvoke).then(
					(commandResult) => {
						result = commandResult;
						if (!commandResult.ok) {
							window.clearTimeout(timeout);
							unsubscribe();
							reject(new Error(`Command ${commandToInvoke._tag} failed: ${commandResult.error.message}`));
							return;
						}
						done();
					},
					(error: unknown) => {
						window.clearTimeout(timeout);
						unsubscribe();
						reject(error);
					},
				);
			});
		},
		{
			commandToInvoke: commandPayload,
			expectedReceipts: expected.receipts ?? [],
			expectedEventTags: expected.eventTags ?? [],
			waitMs: waitTimeoutMs,
		},
	);
}

async function waitForEvents(page: Page, eventTags: readonly string[]): Promise<GuiEvent[]> {
	return page.evaluate(
		async ({ expectedEventTags, waitMs }) =>
			new Promise<GuiEvent[]>((resolve, reject) => {
				const events: GuiEvent[] = [];
				let unsubscribe: () => void = () => undefined;
				const timeout = window.setTimeout(() => {
					unsubscribe();
					reject(
						new Error(
							`Timed out waiting for events ${expectedEventTags.join(",")}; observed ${events.map((event) => event._tag).join(",")}`,
						),
					);
				}, waitMs);
				unsubscribe = window.piGui.subscribe((event) => {
					events.push(event);
					if (expectedEventTags.every((tag) => events.some((entry) => entry._tag === tag))) {
						window.clearTimeout(timeout);
						unsubscribe();
						resolve(events);
					}
				});
			}),
		{ expectedEventTags: eventTags, waitMs: waitTimeoutMs },
	);
}

async function waitForMatchingEvent(page: Page, eventTag: string): Promise<GuiEvent> {
	return page.evaluate(
		async ({ expectedEventTag, waitMs }) =>
			new Promise<GuiEvent>((resolve, reject) => {
				let unsubscribe: () => void = () => undefined;
				const timeout = window.setTimeout(() => {
					unsubscribe();
					reject(new Error(`Timed out waiting for event ${expectedEventTag}`));
				}, waitMs);
				unsubscribe = window.piGui.subscribe((event) => {
					if (event._tag !== expectedEventTag) return;
					window.clearTimeout(timeout);
					unsubscribe();
					resolve(event);
				});
			}),
		{ expectedEventTag: eventTag, waitMs: waitTimeoutMs },
	);
}
