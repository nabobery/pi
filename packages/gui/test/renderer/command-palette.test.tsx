/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type SlashCommandSnapshot,
} from "../../src/contracts/index.ts";
import { CommandPalette, ResumePicker } from "../../src/renderer/app/command-palette.tsx";
import type { CatalogViewState, GuiCatalogStore } from "../../src/renderer/app/app-store.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");
const sessionKey = `${workspaceId}:${sessionId}`;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

afterEach(() => {
	for (const root of mountedRoots.splice(0)) {
		act(() => root.unmount());
	}
	for (const container of mountedContainers.splice(0)) {
		container.remove();
	}
});

describe("command palette", () => {
	test("inserts dynamic slash commands into the composer", async () => {
		const store = storeStub();
		render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithCommandPalette([
					{
						name: "fake-extension",
						description: "Fake extension",
						source: "extension",
						availability: "sendable",
					},
				])}
				store={store}
			/>,
		);

		await click(buttonByText("Fake extension"));

		expect(store.setComposerDraft).toHaveBeenCalledWith(workspaceId, sessionId, "/fake-extension ");
		expect(store.closeCommandPalette).toHaveBeenCalledOnce();
	});

	test("runs supported GUI built-ins and keeps deferred commands disabled", async () => {
		const store = storeStub();
		render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithCommandPalette([
					{
						name: "resume",
						description: "Resume session",
						source: "builtin",
						availability: "guiAction",
					},
					{
						name: "compact",
						description: "Compact session",
						source: "builtin",
						availability: "deferred",
						disabledReason: "Not implemented",
					},
				])}
				store={store}
			/>,
		);

		await click(buttonByText("Resume session"));

		expect(store.closeCommandPalette).toHaveBeenCalledOnce();
		expect(store.openResumePicker).toHaveBeenCalledWith(workspaceId);
		expect(buttonByText("Compact session").disabled).toBe(true);
	});

	test("opens tree navigator and compact dialog for supported GUI built-ins", async () => {
		const store = storeStub();
		render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithCommandPalette([
					{
						name: "tree",
						description: "Navigate session tree",
						source: "builtin",
						availability: "guiAction",
					},
					{
						name: "compact",
						description: "Compact session",
						source: "builtin",
						availability: "guiAction",
					},
				])}
				store={store}
			/>,
		);

		await click(buttonByText("Navigate session tree"));
		await click(buttonByText("Compact session"));

		expect(store.openTreeNavigator).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.openCompactDialog).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.closeCommandPalette).toHaveBeenCalledTimes(2);
	});

	test("supports keyboard filtering and selection", async () => {
		const store = storeStub();
		render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithCommandPalette([
					{
						name: "first",
						description: "First command",
						source: "extension",
						availability: "sendable",
					},
					{
						name: "second",
						description: "Second command",
						source: "extension",
						availability: "sendable",
					},
				])}
				store={store}
			/>,
		);

		await key(inputByLabel("Search slash commands"), "ArrowDown");
		await key(inputByLabel("Search slash commands"), "Enter");

		expect(store.setCommandPaletteSelectedIndex).toHaveBeenCalledWith(1);
	});

	test("loads missing catalogs, filters queries, closes on Escape, and runs additional GUI built-ins", async () => {
		const store = storeStub();
		const settingsPanel = document.createElement("div");
		settingsPanel.id = "settings-trust-panel";
		settingsPanel.tabIndex = -1;
		document.body.append(settingsPanel);
		mountedContainers.push(settingsPanel);
		const modelPanel = document.createElement("div");
		modelPanel.id = "runtime-controls";
		modelPanel.tabIndex = -1;
		document.body.append(modelPanel);
		mountedContainers.push(modelPanel);

		const baseState = stateWithCommandPalette([
			{ name: "new", description: "New session", source: "builtin", availability: "guiAction" },
			{ name: "settings", description: "Open settings", source: "builtin", availability: "guiAction" },
			{ name: "model", description: "Model picker", source: "builtin", availability: "guiAction" },
		]);
		render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={{
					...baseState,
					slashCommandCatalogsBySessionKey: {},
					commandPalette: { open: true, query: "mod", selectedIndex: 0, loading: true, error: "Catalog failed" },
				}}
				store={store}
			/>,
		);

		expect(store.getSlashCommands).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(document.body.textContent).toContain("Loading commands.");
		expect(document.body.textContent).toContain("Catalog failed");
		await change(inputByLabel("Search slash commands"), "/new");
		await key(inputByLabel("Search slash commands"), "Escape");
		expect(store.setCommandPaletteQuery).toHaveBeenCalledWith("/new");
		expect(store.closeCommandPalette).toHaveBeenCalled();

		const mounted = render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={baseState}
				store={store}
			/>,
		);
		await click(buttonByText("New session"));
		mounted.rerender(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={baseState}
				store={store}
			/>,
		);
		await click(buttonByText("Open settings"));
		mounted.rerender(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={baseState}
				store={store}
			/>,
		);
		await click(buttonByText("Model picker"));

		expect(store.createSession).toHaveBeenCalledWith(workspaceId);
		expect(document.activeElement).toBe(modelPanel);
	});

	test("requests current session rename for /name", async () => {
		const store = storeStub();
		render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithCommandPalette([
					{ name: "name", description: "Set session display name", source: "builtin", availability: "guiAction" },
				])}
				store={store}
			/>,
		);

		await click(buttonByText("Set session display name"));

		expect(store.requestSessionRename).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.closeCommandPalette).toHaveBeenCalledOnce();
	});

	test("closes from non-input focus and restores previous focus", async () => {
		const store = storeStub();
		const launcher = document.createElement("button");
		launcher.textContent = "Launcher";
		document.body.append(launcher);
		mountedContainers.push(launcher);
		launcher.focus();
		const mounted = render(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithCommandPalette([
					{
						name: "fake-extension",
						description: "Fake extension",
						source: "extension",
						availability: "sendable",
					},
				])}
				store={store}
			/>,
		);

		await key(buttonByText("Fake extension"), "Escape");
		mounted.rerender(
			<CommandPalette
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={{ ...stateWithCommandPalette([]), commandPalette: { ...emptyState().commandPalette, open: false } }}
				store={store}
			/>,
		);

		expect(store.closeCommandPalette).toHaveBeenCalled();
		expect(document.activeElement).toBe(launcher);
	});
});

describe("resume picker", () => {
	test("searches, opens, renames, and archives sessions", async () => {
		const store = storeStub();
		render(
			<ResumePicker
				selectedWorkspaceId={workspaceId}
				state={{
					...emptyState(),
					resumePicker: {
						open: true,
						query: "",
						scope: "currentWorkspace",
						sortMode: "threaded",
						nameFilter: "all",
						includeArchived: false,
						showPaths: true,
						selectedIndex: 0,
						loading: false,
						error: undefined,
						result: {
							workspaceId,
							query: "",
							scope: "currentWorkspace",
							sortMode: "threaded",
							nameFilter: "all",
							includeArchived: false,
							totalCount: 1,
							filteredCount: 1,
							searchedAt: "2026-06-19T00:00:00.000Z",
							results: [
								{
									workspaceId,
									workspaceName: "workspace",
									sessionId,
									title: "Named session",
									preview: "hello",
									messageCount: 2,
									updatedAt: "2026-06-19T00:00:00.000Z",
									createdAt: "2026-06-18T00:00:00.000Z",
									cwd: "/tmp/workspace",
									sessionFilePath: "/tmp/session.jsonl",
									isOpen: true,
									isRunning: false,
								},
							],
						},
					},
				}}
				store={store}
			/>,
		);

		await change(inputByLabel("Search sessions"), "hello");
		await waitForDebounce();
		await click(buttonByText("Named session"));
		await click(buttonByText("Rename"));
		await change(inputByLabel("Session title"), "Renamed");
		await click(buttonByText("Save"));
		await click(buttonByText("Archive"));

		expect(store.searchResume).toHaveBeenCalledWith(workspaceId, { query: "hello" });
		expect(store.resumeOpenSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.renameResumeSession).toHaveBeenCalledWith(workspaceId, sessionId, "Renamed");
		expect(store.resumeArchiveSession).toHaveBeenCalledWith(workspaceId, sessionId);
	});

	test("supports resume controls, keyboard open, restore action, and empty states", async () => {
		const store = storeStub();
		const pickerState = {
			...emptyState(),
			resumePicker: {
				open: true,
				query: "",
				scope: "currentWorkspace" as const,
				sortMode: "threaded" as const,
				nameFilter: "all" as const,
				includeArchived: false,
				showPaths: false,
				selectedIndex: 0,
				loading: false,
				error: "Search failed",
				result: {
					workspaceId,
					query: "",
					scope: "currentWorkspace" as const,
					sortMode: "threaded" as const,
					nameFilter: "all" as const,
					includeArchived: false,
					totalCount: 1,
					filteredCount: 1,
					searchedAt: "2026-06-19T00:00:00.000Z",
					results: [
						{
							workspaceId,
							workspaceName: "workspace",
							sessionId,
							title: "Archived session",
							preview: "",
							messageCount: 1,
							updatedAt: "2026-06-19T00:00:00.000Z",
							createdAt: "2026-06-18T00:00:00.000Z",
							cwd: "/tmp/workspace",
							sessionFilePath: "/tmp/session.jsonl",
							archivedAt: "2026-06-19T00:00:00.000Z",
							isOpen: false,
							isRunning: true,
						},
					],
				},
			},
		};
		render(<ResumePicker selectedWorkspaceId={workspaceId} state={pickerState} store={store} />);

		await key(inputByLabel("Search sessions"), "ArrowDown");
		await key(inputByLabel("Search sessions"), "ArrowUp");
		await key(inputByLabel("Search sessions"), "Enter");
		await changeSelect(selectByLabel("Scope"), "knownWorkspaces");
		await changeSelect(selectByLabel("Sort"), "recent");
		await changeSelect(selectByLabel("Name"), "named");
		await click(checkboxes()[0]);
		await click(checkboxes()[1]);
		await click(buttonByText("Restore"));
		await click(buttonByText("Close"));

		expect(store.setResumePickerSelectedIndex).toHaveBeenCalledWith(0);
		expect(store.resumeOpenSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.searchResume).toHaveBeenCalledWith(workspaceId, { scope: "knownWorkspaces" });
		expect(store.searchResume).toHaveBeenCalledWith(workspaceId, { sortMode: "recent" });
		expect(store.searchResume).toHaveBeenCalledWith(workspaceId, { nameFilter: "named" });
		expect(store.searchResume).toHaveBeenCalledWith(workspaceId, { includeArchived: true });
		expect(store.setResumePickerShowPaths).toHaveBeenCalledWith(true);
		expect(store.resumeUnarchiveSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.closeResumePicker).toHaveBeenCalled();
		expect(document.body.textContent).toContain("Search failed");

		const emptyStore = storeStub();
		render(
			<ResumePicker
				selectedWorkspaceId={workspaceId}
				state={{
					...emptyState(),
					resumePicker: { ...emptyState().resumePicker, open: true, loading: true, result: undefined },
				}}
				store={emptyStore}
			/>,
		);
		expect(document.body.textContent).toContain("Loading sessions.");
	});

	test("restores focus when the resume picker closes", async () => {
		const store = storeStub();
		const launcher = document.createElement("button");
		launcher.textContent = "Resume launcher";
		document.body.append(launcher);
		mountedContainers.push(launcher);
		launcher.focus();
		const mounted = render(
			<ResumePicker selectedWorkspaceId={workspaceId} state={pickerStateWithSessions()} store={store} />,
		);

		await key(buttonByText("Close"), "Escape");
		mounted.rerender(
			<ResumePicker
				selectedWorkspaceId={workspaceId}
				state={{ ...pickerStateWithSessions(), resumePicker: { ...emptyState().resumePicker, open: false } }}
				store={store}
			/>,
		);

		expect(store.closeResumePicker).toHaveBeenCalled();
		expect(document.activeElement).toBe(launcher);
	});
});

function stateWithCommandPalette(commands: SlashCommandSnapshot[]): CatalogViewState {
	return {
		...emptyState(),
		slashCommandCatalogsBySessionKey: {
			[sessionKey]: {
				workspaceId,
				sessionId,
				commands,
				updatedAt: "2026-06-19T00:00:00.000Z",
			},
		},
		commandPalette: { open: true, query: "", selectedIndex: 0, loading: false, error: undefined },
	};
}

function emptyState(): CatalogViewState {
	return {
		workspaceCatalog: {
			revision: catalogRevisionFromString("1"),
			selectedWorkspaceId: workspaceId,
			workspaces: [
				{
					id: workspaceId,
					path: "/tmp/workspace",
					name: "workspace",
					lastOpenedAt: "2026-06-19T00:00:00.000Z",
					sortOrder: 0,
					missing: false,
					selected: true,
				},
			],
		},
		sessionCatalogs: {},
		timelines: {},
		queuesBySessionKey: {},
		imageAttachmentsBySessionKey: {},
		exportsBySessionKey: {},
		sharesBySessionKey: {},
		sessionArtifactStateBySessionKey: {},
		composerDrafts: {},
		modelThinkingBySessionKey: {},
		settingsSummaryByWorkspaceId: {},
		settingsEditorByWorkspaceId: {},
		trustStatusByWorkspaceId: {},
		resourceInventoryByWorkspaceId: {},
		extensionUiBySessionKey: {},
		runtimeOverlaysBySessionKey: {},
		activityBySessionKey: {},
		slashCommandCatalogsBySessionKey: {},
		treesBySessionKey: {},
		sessionRenameRequestsBySessionKey: {},
		commandPalette: { open: false, query: "", selectedIndex: 0, loading: false, error: undefined },
		resumePicker: {
			open: false,
			query: "",
			scope: "currentWorkspace",
			sortMode: "threaded",
			nameFilter: "all",
			includeArchived: false,
			showPaths: false,
			selectedIndex: 0,
			loading: false,
			error: undefined,
			result: undefined,
		},
		treeNavigator: {
			open: false,
			workspaceId: undefined,
			sessionId: undefined,
			query: "",
			filterMode: "default",
			selectedEntryId: undefined,
			foldedEntryIds: [],
			loading: false,
			navigationCancelling: false,
			navigationPending: false,
			error: undefined,
		},
		compactDialog: {
			open: false,
			workspaceId: undefined,
			sessionId: undefined,
			customInstructions: "",
			compacting: false,
			error: undefined,
			lastResult: undefined,
			cancelling: false,
		},
		controlPlane: { open: false, tab: "settings", loading: false, error: undefined },
		error: undefined,
		pending: false,
	};
}

function pickerStateWithSessions(): CatalogViewState {
	return {
		...emptyState(),
		resumePicker: {
			open: true,
			query: "",
			scope: "currentWorkspace",
			sortMode: "threaded",
			nameFilter: "all",
			includeArchived: false,
			showPaths: false,
			selectedIndex: 0,
			loading: false,
			error: undefined,
			result: {
				workspaceId,
				query: "",
				scope: "currentWorkspace",
				sortMode: "threaded",
				nameFilter: "all",
				includeArchived: false,
				totalCount: 1,
				filteredCount: 1,
				searchedAt: "2026-06-19T00:00:00.000Z",
				results: [
					{
						workspaceId,
						workspaceName: "workspace",
						sessionId,
						title: "Session",
						preview: "hello",
						messageCount: 2,
						updatedAt: "2026-06-19T00:00:00.000Z",
						createdAt: "2026-06-18T00:00:00.000Z",
						cwd: "/tmp/workspace",
						sessionFilePath: "/tmp/session.jsonl",
						isOpen: false,
						isRunning: false,
					},
				],
			},
		},
	};
}

function storeStub(): GuiCatalogStore {
	return {
		archiveSession: vi.fn().mockResolvedValue(undefined),
		cancelRun: vi.fn().mockResolvedValue(undefined),
		closeCommandPalette: vi.fn(),
		closeCompactDialog: vi.fn(),
		closeControlPlane: vi.fn(),
		closeResumePicker: vi.fn(),
		closeSession: vi.fn().mockResolvedValue(undefined),
		closeTreeNavigator: vi.fn(),
		compactSession: vi.fn().mockResolvedValue(undefined),
		createSession: vi.fn().mockResolvedValue(undefined),
		getSettingsSummary: vi.fn().mockResolvedValue(undefined),
		getResourceInventory: vi.fn().mockResolvedValue(undefined),
		getSettingsEditor: vi.fn().mockResolvedValue(undefined),
		getSlashCommands: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn(),
		getTree: vi.fn().mockResolvedValue(undefined),
		getTranscript: vi.fn().mockResolvedValue(undefined),
		getTrustStatus: vi.fn().mockResolvedValue(undefined),
		openCommandPalette: vi.fn(),
		openCompactDialog: vi.fn(),
		openControlPlane: vi.fn().mockResolvedValue(undefined),
		openResumePicker: vi.fn().mockResolvedValue(undefined),
		openSession: vi.fn().mockResolvedValue(undefined),
		openTreeNavigator: vi.fn(),
		navigateTree: vi.fn().mockResolvedValue(undefined),
		openSettingsFile: vi.fn().mockResolvedValue(undefined),
		openArtifact: vi.fn().mockResolvedValue(undefined),
		openExternalArtifact: vi.fn().mockResolvedValue(undefined),
		pickWorkspaceDirectory: vi.fn().mockResolvedValue(undefined),
		pasteImageFromClipboard: vi.fn().mockResolvedValue(undefined),
		pickImages: vi.fn().mockResolvedValue(undefined),
		renameResumeSession: vi.fn().mockResolvedValue(undefined),
		renameSession: vi.fn().mockResolvedValue(undefined),
		requestSessionRename: vi.fn(),
		respondToExtensionUi: vi.fn().mockResolvedValue(undefined),
		resumeArchiveSession: vi.fn().mockResolvedValue(undefined),
		resumeOpenSession: vi.fn().mockResolvedValue(undefined),
		resumeUnarchiveSession: vi.fn().mockResolvedValue(undefined),
		restoreQueuedMessages: vi.fn().mockResolvedValue(undefined),
		clearImageAttachments: vi.fn().mockResolvedValue(undefined),
		exportSession: vi.fn().mockResolvedValue(undefined),
		openResourceSource: vi.fn().mockResolvedValue(undefined),
		removeImageAttachment: vi.fn().mockResolvedValue(undefined),
		revealSettingsFile: vi.fn().mockResolvedValue(undefined),
		revealArtifact: vi.fn().mockResolvedValue(undefined),
		reloadResources: vi.fn().mockResolvedValue(undefined),
		revealResourceSource: vi.fn().mockResolvedValue(undefined),
		searchResume: vi.fn().mockResolvedValue(undefined),
		selectWorkspace: vi.fn().mockResolvedValue(undefined),
		sendMessage: vi.fn().mockResolvedValue(true),
		shareSession: vi.fn().mockResolvedValue(undefined),
		setCommandPaletteQuery: vi.fn(),
		setCommandPaletteSelectedIndex: vi.fn(),
		setCompactInstructions: vi.fn(),
		setComposerDraft: vi.fn(),
		setModel: vi.fn().mockResolvedValue(undefined),
		setResumePickerSelectedIndex: vi.fn(),
		setResumePickerShowPaths: vi.fn(),
		setThinkingLevel: vi.fn().mockResolvedValue(undefined),
		saveTrustDecision: vi.fn().mockResolvedValue(undefined),
		updateCommonSettings: vi.fn().mockResolvedValue(undefined),
		setTreeEntryLabel: vi.fn().mockResolvedValue(undefined),
		setTreeNavigatorFilterMode: vi.fn(),
		setTreeNavigatorQuery: vi.fn(),
		setTreeNavigatorSelectedEntry: vi.fn(),
		subscribe: vi.fn(),
		syncWorkspace: vi.fn().mockResolvedValue(undefined),
		cancelCompaction: vi.fn().mockResolvedValue(undefined),
		cancelTreeNavigation: vi.fn().mockResolvedValue(undefined),
		collapseTreeNavigatorEntry: vi.fn(),
		expandTreeNavigatorEntry: vi.fn(),
		unarchiveSession: vi.fn().mockResolvedValue(undefined),
	};
}

function render(node: ReactNode) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedRoots.push(root);
	mountedContainers.push(container);
	act(() => root.render(node));
	return {
		container,
		rerender: (nextNode: ReactNode) => {
			act(() => root.render(nextNode));
		},
		root,
	};
}

async function click(element: HTMLElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

async function change(element: HTMLInputElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	descriptor?.set?.call(element, value);
	await act(async () => {
		element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
	});
}

async function changeSelect(element: HTMLSelectElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	descriptor?.set?.call(element, value);
	await act(async () => {
		element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
	});
}

async function key(element: HTMLElement, keyValue: string): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new KeyboardEvent("keydown", { key: keyValue, bubbles: true }));
	});
}

async function waitForDebounce(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 190));
	});
}

function inputByLabel(label: string): HTMLInputElement {
	const input = document.querySelector(`input[aria-label="${label}"]`);
	if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`);
	return input;
}

function selectByLabel(label: string): HTMLSelectElement {
	const labels = [...document.querySelectorAll("label")];
	const wrapper = labels.find((candidate) => candidate.textContent?.includes(label));
	const select = wrapper?.querySelector("select");
	if (!(select instanceof HTMLSelectElement)) throw new Error(`Missing select: ${label}`);
	return select;
}

function checkboxes(): HTMLInputElement[] {
	return [...document.querySelectorAll('input[type="checkbox"]')].filter(
		(input): input is HTMLInputElement => input instanceof HTMLInputElement,
	);
}

function buttonByText(text: string): HTMLButtonElement {
	const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
	if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
	return button;
}
