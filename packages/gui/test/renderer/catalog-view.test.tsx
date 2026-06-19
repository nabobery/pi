/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	sessionIdFromString,
	workspaceIdFromString,
	type SessionCatalogSnapshot,
	type SessionSnapshot,
	type TimelineSnapshot,
	type WorkspaceSnapshot,
} from "../../src/contracts/index.ts";
import type { GuiCatalogStore } from "../../src/renderer/app/app-store.ts";
import { MainPane, SessionSection, WorkspaceSection } from "../../src/renderer/app/catalog-view.tsx";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");
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

describe("catalog view", () => {
	test("renders empty workspace and no-session states", () => {
		const markup = renderToStaticMarkup(
			<>
				<WorkspaceSection store={storeStub()} workspaces={[]} selectedWorkspace={undefined} />
				<SessionSection
					activityBySessionKey={{}}
					runtimeOverlaysBySessionKey={{}}
					sessionRenameRequestsBySessionKey={{}}
					store={storeStub()}
					pending={false}
					selectedWorkspace={undefined}
					sessionCatalog={undefined}
				/>
				<MainPane session={undefined} timeline={undefined} />
			</>,
		);

		expect(markup).toContain("No workspace open.");
		expect(markup).toContain("Select a workspace.");
		expect(markup).toContain("No active session");
	});

	test("renders missing workspace recovery state", () => {
		const workspace = workspaceSnapshot({ missing: true });

		const markup = renderToStaticMarkup(
			<>
				<WorkspaceSection store={storeStub()} workspaces={[workspace]} selectedWorkspace={workspace} />
				<SessionSection
					activityBySessionKey={{}}
					runtimeOverlaysBySessionKey={{}}
					sessionRenameRequestsBySessionKey={{}}
					store={storeStub()}
					pending={false}
					selectedWorkspace={workspace}
					sessionCatalog={undefined}
				/>
			</>,
		);

		expect(markup).toContain("Missing");
		expect(markup).toContain("Workspace path is missing.");
		expect(markup).toContain("Sync");
	});

	test("renders selected and archived session metadata", () => {
		const workspace = workspaceSnapshot({ missing: false });
		const catalog: SessionCatalogSnapshot = {
			workspaceId,
			selectedSessionId: sessionId,
			sessions: [
				sessionSnapshot({ id: sessionId, title: "Active session" }),
				sessionSnapshot({ title: "Archived", archivedAt: "2026-06-19T01:00:00.000Z" }),
			],
		};

		const markup = renderToStaticMarkup(
			<SessionSection
				activityBySessionKey={{}}
				runtimeOverlaysBySessionKey={{}}
				sessionRenameRequestsBySessionKey={{}}
				store={storeStub()}
				pending={false}
				selectedWorkspace={workspace}
				sessionCatalog={catalog}
			/>,
		);

		expect(markup).toContain("Active session");
		expect(markup).toContain("running - 2 messages");
		expect(markup).toContain("Archived (1)");
		expect(markup).toContain("Restore");
	});

	test("renders session activity badges and routes per-session runtime actions", async () => {
		const store = storeStub();
		const workspace = workspaceSnapshot({ missing: false });
		const catalog: SessionCatalogSnapshot = {
			workspaceId,
			selectedSessionId: sessionId,
			sessions: [sessionSnapshot({ id: sessionId, title: "Active session" })],
		};
		const mounted = renderView(
			<SessionSection
				activityBySessionKey={{
					"workspace-1:session-1": {
						workspaceId,
						sessionId,
						hasUnread: true,
						needsInput: true,
						queueCount: 2,
						lastActivitySequence: 3,
					},
				}}
				runtimeOverlaysBySessionKey={{ "workspace-1:session-1": { status: "running", isOpen: true } }}
				sessionRenameRequestsBySessionKey={{}}
				store={store}
				pending={false}
				selectedWorkspace={workspace}
				sessionCatalog={catalog}
			/>,
		);

		expect(mounted.container.textContent).toContain("Unread");
		expect(mounted.container.textContent).toContain("Input");
		expect(mounted.container.textContent).toContain("2 queued");

		await click(buttonByText(mounted.container, "Cancel"));
		await click(buttonByText(mounted.container, "Close"));

		expect(store.cancelRun).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.closeSession).toHaveBeenCalledWith(workspaceId, sessionId);
	});

	test("hides close action for catalog sessions without an open runtime", () => {
		const workspace = workspaceSnapshot({ missing: false });
		const catalog: SessionCatalogSnapshot = {
			workspaceId,
			selectedSessionId: sessionId,
			sessions: [sessionSnapshot({ id: sessionId, title: "Idle session", status: "idle" })],
		};
		const mounted = renderView(
			<SessionSection
				activityBySessionKey={{}}
				runtimeOverlaysBySessionKey={{}}
				sessionRenameRequestsBySessionKey={{}}
				store={storeStub()}
				pending={false}
				selectedWorkspace={workspace}
				sessionCatalog={catalog}
			/>,
		);

		expect(buttonTextList(mounted.container)).not.toContain("Close");
	});

	test("renders transcript rows for user, assistant, tool, and error entries", () => {
		const timeline: TimelineSnapshot = {
			workspaceId,
			sessionId,
			entries: [
				{ id: "entry-1", kind: "user", text: "User prompt" },
				{ id: "entry-2", kind: "assistant", text: "Assistant reply" },
				{
					id: "entry-3",
					kind: "tool",
					text: "",
					toolCallId: "tool-1",
					toolName: "read_file",
					isLive: true,
				},
				{ id: "entry-4", kind: "error", text: "Runtime failed", isError: true },
			],
		};

		const markup = renderToStaticMarkup(<MainPane session={sessionSnapshot({})} timeline={timeline} />);

		expect(markup).toContain("running");
		expect(markup).toContain("User prompt");
		expect(markup).toContain("Assistant reply");
		expect(markup).toContain("read_file");
		expect(markup).toContain("Waiting for tool output.");
		expect(markup).toContain("Runtime failed");
	});

	test("routes workspace and session controls through the catalog store", async () => {
		const store = storeStub();
		const workspace = workspaceSnapshot({ missing: false });
		const archivedSession = sessionSnapshot({
			id: sessionIdFromString("session-archived"),
			title: "Archived",
			archivedAt: "2026-06-19T01:00:00.000Z",
		});
		const activeSession = sessionSnapshot({ id: sessionId, title: "Active session" });
		const catalog: SessionCatalogSnapshot = {
			workspaceId,
			selectedSessionId: sessionId,
			sessions: [activeSession, archivedSession],
		};
		const mounted = renderView(
			<>
				<WorkspaceSection store={store} workspaces={[workspace]} selectedWorkspace={workspace} />
				<SessionSection
					activityBySessionKey={{}}
					runtimeOverlaysBySessionKey={{}}
					sessionRenameRequestsBySessionKey={{}}
					store={store}
					pending={false}
					selectedWorkspace={workspace}
					sessionCatalog={catalog}
				/>
			</>,
		);

		await click(buttonByText(mounted.container, "Add"));
		await click(buttonByText(mounted.container, "workspaceReady"));
		await click(buttonByText(mounted.container, "Sync"));
		await click(buttonByText(mounted.container, "New"));
		await click(buttonByText(mounted.container, "Active sessionpreviewrunning - 2 messages"));
		await click(buttonByText(mounted.container, "Rename"));
		await changeInput(inputByLabel(mounted.container, "Session title"), "Renamed");
		await submit(form(mounted.container));
		await click(buttonByText(mounted.container, "Archive"));
		await click(buttonByText(mounted.container, "Restore"));

		expect(store.pickWorkspaceDirectory).toHaveBeenCalledOnce();
		expect(store.selectWorkspace).toHaveBeenCalledWith(workspaceId);
		expect(store.syncWorkspace).toHaveBeenCalledWith(workspaceId);
		expect(store.createSession).toHaveBeenCalledWith(workspaceId);
		expect(store.openSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.renameSession).toHaveBeenCalledWith(workspaceId, sessionId, "Renamed");
		expect(store.archiveSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(store.unarchiveSession).toHaveBeenCalledWith(workspaceId, archivedSession.id);
	});
});

function renderView(node: ReactNode): { container: HTMLElement; root: Root } {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedRoots.push(root);
	mountedContainers.push(container);
	act(() => root.render(node));
	return { container, root };
}

async function click(element: HTMLElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

async function submit(element: HTMLFormElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	});
}

async function changeInput(element: HTMLInputElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	descriptor?.set?.call(element, value);
	await act(async () => {
		element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
	});
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
	for (const button of Array.from(container.querySelectorAll("button"))) {
		if (button.textContent === text) return button;
	}
	throw new Error(`Expected button ${text}`);
}

function buttonTextList(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("button")).map((button) => button.textContent ?? "");
}

function form(container: HTMLElement): HTMLFormElement {
	const element = container.querySelector("form");
	if (!(element instanceof HTMLFormElement)) throw new Error("Expected form");
	return element;
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
	const element = container.querySelector(`input[aria-label="${label}"]`);
	if (!(element instanceof HTMLInputElement)) throw new Error(`Expected input ${label}`);
	return element;
}

function workspaceSnapshot(options: { missing: boolean }): WorkspaceSnapshot {
	return {
		id: workspaceId,
		path: "/tmp/workspace",
		name: "workspace",
		lastOpenedAt: "2026-06-19T00:00:00.000Z",
		sortOrder: 0,
		missing: options.missing,
		selected: true,
	};
}

function sessionSnapshot(options: {
	archivedAt?: string;
	id?: typeof sessionId;
	status?: SessionSnapshot["status"];
	title?: string;
}): SessionSnapshot {
	return {
		id: options.id ?? sessionIdFromString(`session-${options.title ?? "active"}`),
		workspaceId,
		title: options.title ?? "Session",
		status: options.status ?? "running",
		updatedAt: "2026-06-19T00:00:00.000Z",
		preview: "preview",
		messageCount: 2,
		sessionFilePath: "/tmp/workspace/.pi/sessions/session.jsonl",
		archivedAt: options.archivedAt,
	};
}

function storeStub(): GuiCatalogStore {
	return {
		archiveSession: vi.fn().mockResolvedValue(undefined),
		cancelRun: vi.fn().mockResolvedValue(undefined),
		closeCommandPalette: vi.fn(),
		closeCompactDialog: vi.fn(),
		closeResumePicker: vi.fn(),
		closeSession: vi.fn().mockResolvedValue(undefined),
		closeTreeNavigator: vi.fn(),
		compactSession: vi.fn().mockResolvedValue(undefined),
		createSession: vi.fn().mockResolvedValue(undefined),
		getSlashCommands: vi.fn().mockResolvedValue(undefined),
		getSettingsSummary: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn(),
		getTree: vi.fn().mockResolvedValue(undefined),
		getTranscript: vi.fn().mockResolvedValue(undefined),
		getTrustStatus: vi.fn().mockResolvedValue(undefined),
		openCommandPalette: vi.fn(),
		openCompactDialog: vi.fn(),
		openResumePicker: vi.fn().mockResolvedValue(undefined),
		openSession: vi.fn().mockResolvedValue(undefined),
		openSettingsFile: vi.fn().mockResolvedValue(undefined),
		openTreeNavigator: vi.fn(),
		navigateTree: vi.fn().mockResolvedValue(undefined),
		pickWorkspaceDirectory: vi.fn().mockResolvedValue(undefined),
		renameSession: vi.fn().mockResolvedValue(undefined),
		renameResumeSession: vi.fn().mockResolvedValue(undefined),
		requestSessionRename: vi.fn(),
		respondToExtensionUi: vi.fn().mockResolvedValue(undefined),
		revealSettingsFile: vi.fn().mockResolvedValue(undefined),
		resumeArchiveSession: vi.fn().mockResolvedValue(undefined),
		resumeOpenSession: vi.fn().mockResolvedValue(undefined),
		resumeUnarchiveSession: vi.fn().mockResolvedValue(undefined),
		restoreQueuedMessages: vi.fn().mockResolvedValue(undefined),
		searchResume: vi.fn().mockResolvedValue(undefined),
		selectWorkspace: vi.fn().mockResolvedValue(undefined),
		sendMessage: vi.fn().mockResolvedValue(true),
		setComposerDraft: vi.fn(),
		setCommandPaletteQuery: vi.fn(),
		setCommandPaletteSelectedIndex: vi.fn(),
		setCompactInstructions: vi.fn(),
		setModel: vi.fn().mockResolvedValue(undefined),
		setResumePickerSelectedIndex: vi.fn(),
		setResumePickerShowPaths: vi.fn(),
		setThinkingLevel: vi.fn().mockResolvedValue(undefined),
		setTreeEntryLabel: vi.fn().mockResolvedValue(undefined),
		setTreeNavigatorFilterMode: vi.fn(),
		setTreeNavigatorQuery: vi.fn(),
		setTreeNavigatorSelectedEntry: vi.fn(),
		subscribe: vi.fn(() => () => undefined),
		syncWorkspace: vi.fn().mockResolvedValue(undefined),
		cancelCompaction: vi.fn().mockResolvedValue(undefined),
		cancelTreeNavigation: vi.fn().mockResolvedValue(undefined),
		collapseTreeNavigatorEntry: vi.fn(),
		expandTreeNavigatorEntry: vi.fn(),
		unarchiveSession: vi.fn().mockResolvedValue(undefined),
	};
}
