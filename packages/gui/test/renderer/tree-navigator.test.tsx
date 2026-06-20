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
	type SessionTreeSnapshot,
} from "../../src/contracts/index.ts";
import type { CatalogViewState, GuiCatalogStore } from "../../src/renderer/app/app-store.ts";
import { CompactDialog, TreeNavigator } from "../../src/renderer/app/tree-navigator.tsx";

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

describe("tree navigator", () => {
	test("uses ARIA tree left and right keyboard behavior", async () => {
		const store = storeStub();
		const mounted = render(
			<TreeNavigator
				draft=""
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithTree({ foldedEntryIds: ["root"], selectedEntryId: "root" })}
				store={store}
			/>,
		);

		await key(inputByLabel("Search session tree"), "ArrowRight");
		expect(store.expandTreeNavigatorEntry).toHaveBeenCalledWith("root");

		mounted.rerender(
			<TreeNavigator
				draft=""
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithTree({ foldedEntryIds: [], selectedEntryId: "root" })}
				store={store}
			/>,
		);
		await key(inputByLabel("Search session tree"), "ArrowRight");
		expect(store.setTreeNavigatorSelectedEntry).toHaveBeenCalledWith("child");

		mounted.rerender(
			<TreeNavigator
				draft=""
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithTree({ foldedEntryIds: [], selectedEntryId: "root" })}
				store={store}
			/>,
		);
		await key(inputByLabel("Search session tree"), "ArrowLeft");
		expect(store.collapseTreeNavigatorEntry).toHaveBeenCalledWith("root");

		mounted.rerender(
			<TreeNavigator
				draft=""
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithTree({ foldedEntryIds: [], selectedEntryId: "child" })}
				store={store}
			/>,
		);
		await key(inputByLabel("Search session tree"), "ArrowLeft");
		expect(store.setTreeNavigatorSelectedEntry).toHaveBeenCalledWith("root");
	});

	test("enters selected tree navigation from the keyboard", async () => {
		const store = storeStub();
		render(
			<TreeNavigator
				draft=""
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithTree({ foldedEntryIds: [], selectedEntryId: "child" })}
				store={store}
			/>,
		);

		await key(inputByLabel("Search session tree"), "Enter");

		expect(store.navigateTree).toHaveBeenCalledWith({
			workspaceId,
			sessionId,
			targetEntryId: "child",
			summaryMode: "none",
		});
	});

	test("cancels pending tree navigation from Escape and keeps the dialog open", async () => {
		const store = storeStub();
		render(
			<TreeNavigator
				draft=""
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={stateWithTree({ foldedEntryIds: [], navigationPending: true, selectedEntryId: "child" })}
				store={store}
			/>,
		);

		await key(inputByLabel("Search session tree"), "Escape");

		expect(store.cancelTreeNavigation).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.closeTreeNavigator).not.toHaveBeenCalled();
	});
});

describe("compact dialog", () => {
	test("keeps cancel enabled while compacting and calls cancellation", async () => {
		const store = storeStub();
		render(<CompactDialog state={stateWithCompactDialog({ compacting: true })} store={store} />);

		const cancel = buttonByText("Cancel");
		expect(cancel.disabled).toBe(false);
		await click(cancel);

		expect(store.cancelCompaction).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.closeCompactDialog).not.toHaveBeenCalled();
	});
});

function stateWithTree(patch: Partial<CatalogViewState["treeNavigator"]>): CatalogViewState {
	return {
		...emptyState(),
		treesBySessionKey: { [sessionKey]: treeSnapshot() },
		treeNavigator: {
			...emptyState().treeNavigator,
			open: true,
			workspaceId,
			sessionId,
			...patch,
		},
	};
}

function stateWithCompactDialog(patch: Partial<CatalogViewState["compactDialog"]>): CatalogViewState {
	return {
		...emptyState(),
		compactDialog: {
			...emptyState().compactDialog,
			open: true,
			workspaceId,
			sessionId,
			...patch,
		},
	};
}

function treeSnapshot(): SessionTreeSnapshot {
	return {
		workspaceId,
		sessionId,
		leafEntryId: "child",
		updatedAt: "2026-06-20T00:00:00.000Z",
		entries: [
			{
				entryId: "root",
				parentId: null,
				childIds: ["child"],
				depth: 0,
				kind: "user",
				textPreview: "root",
				isActiveLeaf: false,
				isActivePath: true,
				hasChildren: true,
				searchText: "user root",
			},
			{
				entryId: "child",
				parentId: "root",
				childIds: [],
				depth: 1,
				kind: "assistant",
				textPreview: "child",
				isActiveLeaf: true,
				isActivePath: true,
				hasChildren: false,
				searchText: "assistant child",
			},
		],
	};
}

function emptyState(): CatalogViewState {
	return {
		workspaceCatalog: {
			revision: catalogRevisionFromString("1"),
			selectedWorkspaceId: workspaceId,
			workspaces: [],
		},
		sessionCatalogs: {},
		timelines: {},
		queuesBySessionKey: {},
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
			cancelling: false,
			error: undefined,
			lastResult: undefined,
		},
		controlPlane: { open: false, tab: "settings", loading: false, error: undefined },
		error: undefined,
		pending: false,
	};
}

function storeStub(): GuiCatalogStore {
	return {
		archiveSession: vi.fn().mockResolvedValue(undefined),
		cancelCompaction: vi.fn().mockResolvedValue(undefined),
		cancelRun: vi.fn().mockResolvedValue(undefined),
		cancelTreeNavigation: vi.fn().mockResolvedValue(undefined),
		closeControlPlane: vi.fn(),
		closeCommandPalette: vi.fn(),
		closeCompactDialog: vi.fn(),
		closeResumePicker: vi.fn(),
		closeSession: vi.fn().mockResolvedValue(undefined),
		closeTreeNavigator: vi.fn(),
		collapseTreeNavigatorEntry: vi.fn(),
		compactSession: vi.fn().mockResolvedValue(undefined),
		createSession: vi.fn().mockResolvedValue(undefined),
		expandTreeNavigatorEntry: vi.fn(),
		getSettingsSummary: vi.fn().mockResolvedValue(undefined),
		getResourceInventory: vi.fn().mockResolvedValue(undefined),
		getSettingsEditor: vi.fn().mockResolvedValue(undefined),
		getSlashCommands: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn(),
		getTree: vi.fn().mockResolvedValue(undefined),
		getTranscript: vi.fn().mockResolvedValue(undefined),
		getTrustStatus: vi.fn().mockResolvedValue(undefined),
		navigateTree: vi.fn().mockResolvedValue(undefined),
		openCommandPalette: vi.fn(),
		openCompactDialog: vi.fn(),
		openControlPlane: vi.fn().mockResolvedValue(undefined),
		openResumePicker: vi.fn().mockResolvedValue(undefined),
		openSession: vi.fn().mockResolvedValue(undefined),
		openSettingsFile: vi.fn().mockResolvedValue(undefined),
		openTreeNavigator: vi.fn(),
		pickWorkspaceDirectory: vi.fn().mockResolvedValue(undefined),
		renameResumeSession: vi.fn().mockResolvedValue(undefined),
		openResourceSource: vi.fn().mockResolvedValue(undefined),
		renameSession: vi.fn().mockResolvedValue(undefined),
		requestSessionRename: vi.fn(),
		respondToExtensionUi: vi.fn().mockResolvedValue(undefined),
		resumeArchiveSession: vi.fn().mockResolvedValue(undefined),
		resumeOpenSession: vi.fn().mockResolvedValue(undefined),
		resumeUnarchiveSession: vi.fn().mockResolvedValue(undefined),
		restoreQueuedMessages: vi.fn().mockResolvedValue(undefined),
		revealSettingsFile: vi.fn().mockResolvedValue(undefined),
		reloadResources: vi.fn().mockResolvedValue(undefined),
		revealResourceSource: vi.fn().mockResolvedValue(undefined),
		searchResume: vi.fn().mockResolvedValue(undefined),
		selectWorkspace: vi.fn().mockResolvedValue(undefined),
		sendMessage: vi.fn().mockResolvedValue(true),
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
		subscribe: vi.fn(() => () => undefined),
		syncWorkspace: vi.fn().mockResolvedValue(undefined),
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
	};
}

async function click(element: HTMLElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

async function key(element: HTMLElement, keyValue: string): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new KeyboardEvent("keydown", { key: keyValue, bubbles: true }));
	});
}

function inputByLabel(label: string): HTMLInputElement {
	const element = document.querySelector(`input[aria-label="${label}"]`);
	if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${label}`);
	return element;
}

function buttonByText(text: string): HTMLButtonElement {
	const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
		candidate.textContent?.includes(text),
	);
	if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`);
	return button;
}
