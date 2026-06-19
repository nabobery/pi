/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	extensionUiRequestIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type ExtensionUiRequestSnapshot,
	type ModelThinkingSnapshot,
	type SessionSnapshot,
} from "../../src/contracts/index.ts";
import type { GuiCatalogStore } from "../../src/renderer/app/app-store.ts";
import {
	Composer,
	ExtensionUiInlineState,
	ExtensionUiLayer,
	QueuePanel,
	RuntimeControls,
	SettingsTrustPanel,
} from "../../src/renderer/app/app-panels.tsx";

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

describe("renderer app panels", () => {
	test("composer submits ready prompts and exposes steering controls while running", async () => {
		const send = vi.fn();
		const cancel = vi.fn();
		const draftChange = vi.fn();
		const ready = renderPanel(
			<Composer
				appMode="test"
				draft="hello"
				onCancel={cancel}
				onDraftChange={draftChange}
				onSend={send}
				selectedSession={session("ready")}
			/>,
		);

		expect(buttonByText(ready.container, "Send").disabled).toBe(false);
		await changeText(textarea(ready.container), "typed");
		await submit(form(ready.container));
		expect(draftChange).toHaveBeenCalledWith("typed");
		expect(send).toHaveBeenCalledWith();

		const running = renderPanel(
			<Composer
				appMode="test"
				draft="next"
				onCancel={cancel}
				onDraftChange={draftChange}
				onSend={send}
				selectedSession={session("running")}
			/>,
		);
		await submit(form(running.container));
		await click(buttonByText(running.container, "Steer"));
		await click(buttonByText(running.container, "Follow-up"));
		await click(buttonByText(running.container, "Cancel"));

		expect(send).toHaveBeenCalledWith("steer");
		expect(send).toHaveBeenCalledWith("followUp");
		expect(cancel).toHaveBeenCalledOnce();
	});

	test("runtime controls preserve model IDs containing slashes and ignore unavailable runtime changes", async () => {
		const selected: Array<[string, string]> = [];
		const thinkingLevels: string[] = [];
		const modelThinking = modelThinkingSnapshot();
		const mounted = renderPanel(
			<RuntimeControls
				modelThinking={modelThinking}
				onSetModel={(provider, modelId) => selected.push([provider, modelId])}
				onSetThinkingLevel={(level) => thinkingLevels.push(level)}
			/>,
		);
		const selects = selectElements(mounted.container);

		expect(mounted.container.textContent).toContain("openrouter/Claude Sonnet 4");
		expect(selects[0].value).toBe("0");
		await changeSelect(selects[0], "0");
		await changeSelect(selects[1], "off");

		expect(selected).toEqual([["openrouter", "anthropic/claude-sonnet-4"]]);
		expect(thinkingLevels).toEqual(["off"]);

		mounted.rerender(
			<RuntimeControls
				modelThinking={undefined}
				onSetModel={(provider, modelId) => selected.push([provider, modelId])}
				onSetThinkingLevel={(level) => thinkingLevels.push(level)}
			/>,
		);
		const unavailableSelects = selectElements(mounted.container);
		await changeSelect(unavailableSelects[0], "0");
		await changeSelect(unavailableSelects[1], "off");
		expect(selected).toHaveLength(1);
		expect(thinkingLevels).toHaveLength(1);
	});

	test("settings panel routes global and project file actions through the store", async () => {
		const store = storeStub();
		const mounted = renderPanel(
			<SettingsTrustPanel
				selectedWorkspaceId={workspaceId}
				settingsSummary={{
					workspaceId,
					globalSettingsPath: "/tmp/home/.pi/settings.json",
					projectSettingsPath: "/tmp/workspace/.pi/settings.json",
					defaultProvider: "openrouter",
					defaultModel: "anthropic/claude-sonnet-4",
					enableSkillCommands: true,
					steeringMode: "all",
					followUpMode: "all",
					defaultProjectTrust: "ask",
					settingsDiagnostics: [],
				}}
				store={store}
				trustStatus={{
					workspaceId,
					cwd: "/tmp/workspace",
					trusted: true,
					source: "saved",
					requiresTrust: true,
					options: [],
				}}
			/>,
		);

		await click(buttonByText(mounted.container, "Open global"));
		await click(buttonByText(mounted.container, "Reveal global"));
		await click(buttonByText(mounted.container, "Open project"));
		await click(buttonByText(mounted.container, "Reveal project"));

		expect(mounted.container.textContent).toContain("anthropic/claude-sonnet-4");
		expect(mounted.container.textContent).toContain("trusted");
		expect(store.openSettingsFile).toHaveBeenCalledWith(workspaceId, "global");
		expect(store.openSettingsFile).toHaveBeenCalledWith(workspaceId, "project");
		expect(store.revealSettingsFile).toHaveBeenCalledWith(workspaceId, "global");
		expect(store.revealSettingsFile).toHaveBeenCalledWith(workspaceId, "project");
	});

	test("queue panel renders queued messages and restores them to the composer", async () => {
		const restore = vi.fn();
		const mounted = renderPanel(
			<QueuePanel
				queue={{
					workspaceId,
					sessionId,
					steeringMessages: [{ index: 0, text: "Adjust plan", kind: "steering" }],
					followUpMessages: [{ index: 0, text: "Then summarize", kind: "followUp" }],
					steeringCount: 1,
					followUpCount: 1,
					steeringMode: "all",
					followUpMode: "one-at-a-time",
				}}
				onRestore={restore}
			/>,
		);

		expect(mounted.container.textContent).toContain("Adjust plan");
		expect(mounted.container.textContent).toContain("Then summarize");
		expect(mounted.container.textContent).toContain("steering all");
		await click(buttonByText(mounted.container, "Restore to composer"));
		expect(restore).toHaveBeenCalledOnce();
	});

	test("settings panel renders nothing without a selected workspace", () => {
		const mounted = renderPanel(
			<SettingsTrustPanel
				selectedWorkspaceId={undefined}
				settingsSummary={undefined}
				store={storeStub()}
				trustStatus={undefined}
			/>,
		);

		expect(mounted.container.innerHTML).toBe("");
	});

	test("extension inline state surfaces statuses, notifications, and compatibility issues", () => {
		const mounted = renderPanel(
			<ExtensionUiInlineState
				extensionUi={{
					requests: [],
					notifications: [
						{
							workspaceId,
							sessionId,
							kind: "notify",
							message: "Extension notice",
							notifyType: "warning",
						},
					],
					statuses: { build: "running" },
					title: "Extension Title",
					compatibilityIssues: ["Unsupported manifest version"],
				}}
			/>,
		);

		expect(mounted.container.textContent).toContain("Extension Title");
		expect(mounted.container.textContent).toContain("build: running");
		expect(mounted.container.textContent).toContain("Extension notice");
		expect(mounted.container.textContent).toContain("Unsupported manifest version");
	});

	test("extension dialog confirms, cancels with Escape, and submits input/select/editor values", async () => {
		const store = storeStub();
		const confirmRequest = request("confirm");
		const mounted = renderPanel(
			<ExtensionUiLayer
				draft="draft text"
				request={confirmRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);

		await click(buttonByText(mounted.container, "Confirm"));
		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, confirmRequest, {
			kind: "confirm",
			confirmed: true,
		});

		const inputRequest = request("input");
		mounted.rerender(
			<ExtensionUiLayer
				draft="draft text"
				request={inputRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);
		await keyDown("Escape");
		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, inputRequest, {
			kind: "input",
			cancelled: true,
		});
		await changeInput(input(mounted.container), "Ada");
		await submit(form(mounted.container));
		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, inputRequest, {
			kind: "input",
			value: "Ada",
			cancelled: false,
		});

		const selectRequest = request("select");
		mounted.rerender(
			<ExtensionUiLayer
				draft="draft text"
				request={selectRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);
		await changeSelect(selectElements(mounted.container)[0], "choice-b");
		await submit(form(mounted.container));
		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, selectRequest, {
			kind: "select",
			value: "choice-b",
			cancelled: false,
		});

		const editorRequest = request("editor");
		mounted.rerender(
			<ExtensionUiLayer
				draft="draft text"
				request={editorRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);
		await changeText(textarea(mounted.container), "edited");
		await submit(form(mounted.container));
		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, editorRequest, {
			kind: "editor",
			value: "edited",
			cancelled: false,
		});
	});

	test("extension getEditorText responds once per request id with the current draft", () => {
		const store = storeStub();
		const firstRequest = request("getEditorText");
		const mounted = renderPanel(
			<ExtensionUiLayer
				draft="draft one"
				request={firstRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);

		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, firstRequest, {
			kind: "getEditorText",
			value: "draft one",
		});

		mounted.rerender(
			<ExtensionUiLayer
				draft="draft two"
				request={firstRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);
		expect(store.respondToExtensionUi).toHaveBeenCalledTimes(1);

		const secondRequest = { ...firstRequest, id: extensionUiRequestIdFromString("request-getEditorText-2") };
		mounted.rerender(
			<ExtensionUiLayer
				draft="draft three"
				request={secondRequest}
				sessionId={sessionId}
				store={store}
				workspaceId={workspaceId}
			/>,
		);
		expect(store.respondToExtensionUi).toHaveBeenCalledWith(workspaceId, sessionId, secondRequest, {
			kind: "getEditorText",
			value: "draft three",
		});
	});
});

function renderPanel(node: ReactNode): {
	container: HTMLElement;
	rerender(next: ReactNode): void;
	root: Root;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedRoots.push(root);
	mountedContainers.push(container);
	act(() => root.render(node));
	return {
		container,
		root,
		rerender: (next) => {
			act(() => root.render(next));
		},
	};
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
	setNativeValue(element, value);
	await act(async () => {
		element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
	});
}

async function changeText(element: HTMLTextAreaElement, value: string): Promise<void> {
	setNativeValue(element, value);
	await act(async () => {
		element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
	});
}

async function changeSelect(element: HTMLSelectElement, value: string): Promise<void> {
	element.value = value;
	await act(async () => {
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
	});
}

async function keyDown(key: string): Promise<void> {
	await act(async () => {
		document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
	});
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
	for (const button of Array.from(container.querySelectorAll("button"))) {
		if (button.textContent === text) return button;
	}
	throw new Error(`Expected button ${text}`);
}

function form(container: HTMLElement): HTMLFormElement {
	const element = container.querySelector("form");
	if (!(element instanceof HTMLFormElement)) throw new Error("Expected form");
	return element;
}

function input(container: HTMLElement): HTMLInputElement {
	const element = container.querySelector("input");
	if (!(element instanceof HTMLInputElement)) throw new Error("Expected input");
	return element;
}

function textarea(container: HTMLElement): HTMLTextAreaElement {
	const element = container.querySelector("textarea");
	if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected textarea");
	return element;
}

function selectElements(container: HTMLElement): HTMLSelectElement[] {
	return Array.from(container.querySelectorAll("select"));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	descriptor?.set?.call(element, value);
}

function session(status: SessionSnapshot["status"]): SessionSnapshot {
	return {
		id: sessionId,
		workspaceId,
		title: "Session",
		status,
		updatedAt: "2026-06-19T00:00:00.000Z",
		preview: "preview",
		messageCount: 1,
	};
}

function request(kind: ExtensionUiRequestSnapshot["kind"]): ExtensionUiRequestSnapshot {
	return {
		id: extensionUiRequestIdFromString(`request-${kind}`),
		workspaceId,
		sessionId,
		kind,
		title: `${kind} request`,
		message: "Message",
		placeholder: "placeholder",
		options: ["choice-a", "choice-b"],
		prefill: kind === "select" ? "choice-a" : "prefill",
	};
}

function modelThinkingSnapshot(): ModelThinkingSnapshot {
	return {
		workspaceId,
		sessionId,
		provider: "openrouter",
		modelId: "anthropic/claude-sonnet-4",
		modelName: "Claude Sonnet 4",
		thinkingLevel: "medium",
		availableThinkingLevels: ["off", "medium"],
		models: [
			{
				provider: "openrouter",
				modelId: "anthropic/claude-sonnet-4",
				name: "Claude Sonnet 4",
				authAvailable: true,
				supportsThinking: true,
				availableThinkingLevels: ["off", "medium"],
			},
		],
	};
}

function storeStub(): GuiCatalogStore {
	return {
		archiveSession: vi.fn().mockResolvedValue(undefined),
		cancelRun: vi.fn().mockResolvedValue(undefined),
		closeSession: vi.fn().mockResolvedValue(undefined),
		createSession: vi.fn().mockResolvedValue(undefined),
		getSettingsSummary: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn(),
		getTranscript: vi.fn().mockResolvedValue(undefined),
		getTrustStatus: vi.fn().mockResolvedValue(undefined),
		openSession: vi.fn().mockResolvedValue(undefined),
		openSettingsFile: vi.fn().mockResolvedValue(undefined),
		pickWorkspaceDirectory: vi.fn().mockResolvedValue(undefined),
		renameSession: vi.fn().mockResolvedValue(undefined),
		respondToExtensionUi: vi.fn().mockResolvedValue(undefined),
		revealSettingsFile: vi.fn().mockResolvedValue(undefined),
		restoreQueuedMessages: vi.fn().mockResolvedValue(undefined),
		selectWorkspace: vi.fn().mockResolvedValue(undefined),
		sendMessage: vi.fn().mockResolvedValue(true),
		setComposerDraft: vi.fn(),
		setModel: vi.fn().mockResolvedValue(undefined),
		setThinkingLevel: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(() => () => undefined),
		syncWorkspace: vi.fn().mockResolvedValue(undefined),
		unarchiveSession: vi.fn().mockResolvedValue(undefined),
	};
}
