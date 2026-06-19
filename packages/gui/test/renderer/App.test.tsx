/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	ModelThinkingUpdated,
	SessionCatalogUpdated,
	SessionSelected,
	catalogRevisionFromString,
	eventIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type BootstrapSnapshot,
	type GuiEvent,
	type GuiCommandResult,
	type ModelThinkingSnapshot,
	type SessionCatalogSnapshot,
} from "../../src/contracts/index.ts";
import { App, ReadyApp } from "../../src/renderer/app/App.tsx";
import type { RendererCatalogApi } from "../../src/renderer/app/app-store.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

afterEach(() => {
	vi.unstubAllGlobals();
	for (const root of mountedRoots.splice(0)) {
		act(() => root.unmount());
	}
	for (const container of mountedContainers.splice(0)) {
		container.remove();
	}
});

describe("App", () => {
	test("renders the startup shell while bootstrap is loading", () => {
		vi.stubGlobal("window", {
			piGui: {
				invoke: vi.fn(),
				subscribe: vi.fn(() => () => undefined),
			},
		});

		const markup = renderToStaticMarkup(<App />);

		expect(markup).toContain("Starting Pi");
		expect(markup).toContain("Preparing the desktop shell.");
	});

	test("renders the ready shell with selected workspace and session", () => {
		const markup = renderToStaticMarkup(
			<ReadyApp
				api={apiStubMarkup()}
				loadState={{
					status: "ready",
					appInfo: { name: "Pi GUI", version: "1.2.3", mode: "test" },
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
					warnings: [
						{ _tag: "CatalogParseFailed", message: "Recovered catalog" } as NonNullable<
							BootstrapSnapshot["warnings"]
						>[number],
					],
				}}
			/>,
		);

		expect(markup).toContain("workspace");
		expect(markup).toContain("Pi GUI 1.2.3");
		expect(markup).toContain("No active session");
		expect(markup).toContain("Recovered catalog");
	});

	test("renders failed startup state when bootstrap cannot be decoded", async () => {
		vi.stubGlobal("window", {
			piGui: {
				invoke: vi.fn(async () => ({ nope: true })),
				subscribe: vi.fn(() => () => undefined),
			},
		});
		const mounted = renderApp(<App />);

		await act(async () => undefined);

		expect(mounted.container.textContent).toContain("Pi could not start");
		expect(mounted.container.textContent).toContain("Invalid GUI command result");
	});

	test("ready shell loads dependent state, sends prompts, and routes runtime settings", async () => {
		const api = apiStub();
		const sessionCatalog = selectedSessionCatalog();
		const mounted = renderApp(
			<ReadyApp
				api={api}
				loadState={{
					status: "ready",
					appInfo: { name: "Pi GUI", version: "1.2.3", mode: "test" },
					workspaceCatalog: workspaceCatalog(),
					warnings: [],
				}}
			/>,
		);
		const emit = api.emit;

		await act(async () => {
			emit(new SessionCatalogUpdated({ ...eventBase(1), workspaceId, sessions: sessionCatalog.sessions }));
			emit(new SessionSelected({ ...eventBase(2), workspaceId, sessionId }));
			emit(new ModelThinkingUpdated({ ...eventBase(3), snapshot: modelThinkingSnapshot() }));
		});
		await act(async () => undefined);

		expect(api.invoke).toHaveBeenCalledWith(expect.objectContaining({ _tag: "settings.getSummary" }));
		expect(api.invoke).toHaveBeenCalledWith(expect.objectContaining({ _tag: "trust.getStatus" }));
		expect(api.invoke).toHaveBeenCalledWith(expect.objectContaining({ _tag: "session.getTranscript" }));

		await changeText(textarea(mounted.container), "hello");
		await click(buttonByText(mounted.container, "Send"));
		await changeSelect(selectElements(mounted.container)[0], "0");
		await changeSelect(selectElements(mounted.container)[1], "off");

		expect(api.invoke).toHaveBeenCalledWith(expect.objectContaining({ _tag: "extensionUi.updateEditorText" }));
		expect(api.invoke).toHaveBeenCalledWith(
			expect.objectContaining({ _tag: "session.sendMessage", message: "hello" }),
		);
		expect(api.invoke).toHaveBeenCalledWith(
			expect.objectContaining({
				_tag: "session.setModel",
				provider: "openrouter",
				modelId: "anthropic/claude-sonnet-4",
			}),
		);
		expect(api.invoke).toHaveBeenCalledWith(expect.objectContaining({ _tag: "session.setThinkingLevel" }));
		expect(textarea(mounted.container).value).toBe("");
	});
});

function renderApp(node: ReactNode): { container: HTMLElement; root: Root } {
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

async function changeText(element: HTMLTextAreaElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	descriptor?.set?.call(element, value);
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

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
	for (const button of Array.from(container.querySelectorAll("button"))) {
		if (button.textContent === text) return button;
	}
	throw new Error(`Expected button ${text}`);
}

function textarea(container: HTMLElement): HTMLTextAreaElement {
	const element = container.querySelector("textarea");
	if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected textarea");
	return element;
}

function selectElements(container: HTMLElement): HTMLSelectElement[] {
	return Array.from(container.querySelectorAll("select"));
}

function apiStub(): RendererCatalogApi & { emit(event: GuiEvent): void; invoke: ReturnType<typeof vi.fn> } {
	let listener: ((event: GuiEvent) => void) | undefined;
	const invoke = vi.fn(async (command) => {
		if (command._tag === "settings.getSummary") {
			return result({
				workspaceId,
				globalSettingsPath: "/tmp/home/.pi/settings.json",
				projectSettingsPath: "/tmp/workspace/.pi/settings.json",
				enableSkillCommands: true,
				steeringMode: "all",
				followUpMode: "all",
				defaultProjectTrust: "ask",
				settingsDiagnostics: [],
			});
		}
		if (command._tag === "trust.getStatus") {
			return result({
				workspaceId,
				cwd: "/tmp/workspace",
				trusted: false,
				source: "unknown",
				requiresTrust: true,
				options: [],
			});
		}
		if (command._tag === "session.getTranscript") {
			return result({ workspaceId, sessionId, entries: [] });
		}
		if (command._tag === "session.sendMessage") {
			return result(selectedSessionCatalog());
		}
		return result(undefined);
	});
	return {
		emit: (event) => listener?.(event),
		invoke,
		subscribe: vi.fn((nextListener) => {
			listener = nextListener;
			return () => {
				listener = undefined;
			};
		}),
	};
}

function workspaceCatalog() {
	return {
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
	};
}

function selectedSessionCatalog(): SessionCatalogSnapshot {
	return {
		workspaceId,
		selectedSessionId: sessionId,
		sessions: [
			{
				id: sessionId,
				workspaceId,
				title: "Session",
				status: "ready",
				updatedAt: "2026-06-19T00:00:00.000Z",
				preview: "preview",
				messageCount: 1,
				sessionFilePath: "/tmp/workspace/.pi/sessions/session-1.jsonl",
			},
		],
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

function eventBase(sequence: number) {
	return { eventId: eventIdFromString(`event-${sequence}`), sequence };
}

function apiStubMarkup(): RendererCatalogApi {
	return {
		invoke: vi.fn(async (command) => {
			if (command._tag === "settings.getSummary") {
				return result({
					workspaceId,
					globalSettingsPath: "/tmp/home/.pi/settings.json",
					projectSettingsPath: "/tmp/workspace/.pi/settings.json",
					enableSkillCommands: true,
					steeringMode: "all",
					followUpMode: "all",
					defaultProjectTrust: "ask",
					settingsDiagnostics: [],
				});
			}
			if (command._tag === "trust.getStatus") {
				return result({
					workspaceId,
					cwd: "/tmp/workspace",
					trusted: false,
					source: "unknown",
					requiresTrust: true,
					options: [],
				});
			}
			if (command._tag === "session.getTranscript") {
				return result({ workspaceId, sessionId, entries: [] });
			}
			return result(undefined);
		}),
		subscribe: vi.fn(() => () => undefined),
	};
}

function result(data: unknown): GuiCommandResult {
	return { ok: true, requestId: "request-1", data } as GuiCommandResult;
}
