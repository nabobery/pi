import {
	type ModelThinkingSnapshot,
	type SessionId,
	type TimelineSnapshot,
	sessionIdFromString,
} from "../../contracts/index.ts";
import { createRuntimeSessionKey } from "./session-key.ts";
import type {
	OpenRuntimeSessionRequest,
	RuntimeSessionEvent,
	RuntimeSessionHandle,
	SendRuntimeMessageRequest,
	SendRuntimeMessageResult,
	SessionDriver,
} from "./session-driver.ts";
import type { ManagedAgentRuntime, RuntimeAgentSession } from "./runtime-supervisor.ts";
import type { ExtensionHostUiService } from "./extension-host-ui-service.ts";

interface FakeRuntimeState {
	activeRun: FakeActiveRun | undefined;
	entries: TimelineSnapshot["entries"];
	extensionUiContext?: ReturnType<ExtensionHostUiService["createContext"]>;
	listeners: Set<(event: RuntimeSessionEvent) => void>;
}

interface FakeActiveRun {
	reject(error: unknown): void;
	resolve(): void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

export const PI_GUI_FAKE_DRIVER_ENV = "PI_GUI_TEST_FAKE_DRIVER";
export const FAKE_RUNTIME_PROMPTS = {
	delay: "[pi-gui-test:delay]",
	confirm: "[pi-gui-test:confirm]",
	input: "[pi-gui-test:input]",
	select: "[pi-gui-test:select]",
	editor: "[pi-gui-test:editor]",
	compatibilityIssue: "[pi-gui-test:compatibility-issue]",
} as const;

export function shouldUseFakeSessionDriver(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.NODE_ENV === "test" && env[PI_GUI_FAKE_DRIVER_ENV] === "1";
}

export interface FakeSessionDriverOptions {
	extensionHostUiService?: ExtensionHostUiService;
}

export class FakeSessionDriver implements SessionDriver {
	private readonly extensionHostUiService: ExtensionHostUiService | undefined;
	private readonly states = new Map<string, FakeRuntimeState>();

	constructor(options: FakeSessionDriverOptions = {}) {
		this.extensionHostUiService = options.extensionHostUiService;
	}

	async openSession(request: OpenRuntimeSessionRequest): Promise<RuntimeSessionHandle> {
		const sessionId = deriveSessionId(request.sessionFilePath);
		const key = createRuntimeSessionKey(request.workspaceId, sessionId);
		const state: FakeRuntimeState = {
			activeRun: undefined,
			entries: [{ id: "fake-entry-1", kind: "user", text: "Fake session ready." }],
			extensionUiContext: this.extensionHostUiService?.createContext(request.workspaceId, sessionId),
			listeners: new Set(),
		};
		this.states.set(key, state);
		return {
			key,
			runtime: createFakeRuntime(state),
			sessionFilePath: request.sessionFilePath,
			sessionId,
			sessionManager: {
				getSessionId: () => sessionId,
				getEntries: () => [],
			},
			workspaceId: request.workspaceId,
			workspacePath: request.workspacePath,
		} satisfies RuntimeSessionHandle;
	}

	async cancelRun(handle: RuntimeSessionHandle): Promise<void> {
		const state = this.requireState(handle);
		const activeRun = state.activeRun;
		if (!activeRun) return;
		settleActiveRun(state, activeRun, "reject", new Error("Fake run cancelled"));
	}

	async closeSession(handle: RuntimeSessionHandle): Promise<void> {
		const state = this.states.get(handle.key);
		if (state?.activeRun) settleActiveRun(state, state.activeRun, "reject", new Error("Fake session closed"));
		this.states.delete(handle.key);
	}

	async getModelThinking(handle: RuntimeSessionHandle): Promise<ModelThinkingSnapshot> {
		return {
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			provider: "fake",
			modelId: "fake/model",
			modelName: "Fake Model",
			thinkingLevel: "off",
			availableThinkingLevels: ["off"],
			models: [
				{
					provider: "fake",
					modelId: "fake/model",
					name: "Fake Model",
					authAvailable: true,
					supportsThinking: false,
					availableThinkingLevels: ["off"],
				},
			],
		};
	}

	async getTranscript(handle: RuntimeSessionHandle): Promise<TimelineSnapshot> {
		const state = this.requireState(handle);
		return {
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			entries: state.entries,
		};
	}

	async setModel(handle: RuntimeSessionHandle): Promise<ModelThinkingSnapshot> {
		return this.getModelThinking(handle);
	}

	async setThinkingLevel(handle: RuntimeSessionHandle): Promise<ModelThinkingSnapshot> {
		return this.getModelThinking(handle);
	}

	async sendMessage(
		handle: RuntimeSessionHandle,
		request: SendRuntimeMessageRequest,
	): Promise<SendRuntimeMessageResult> {
		const state = this.requireState(handle);
		if (request.deliveryMode) {
			state.entries = [
				...state.entries,
				{ id: `fake-${state.entries.length + 1}`, kind: "user", text: request.message },
			];
			return { completion: Promise.resolve() };
		}

		if (state.activeRun) {
			throw new Error("Fake run is already active");
		}
		let activeRun: FakeActiveRun | undefined;
		const completion = new Promise<void>((resolve, reject) => {
			activeRun = { reject, resolve, timer: undefined };
		});
		const createdRun = activeRun;
		if (!createdRun) throw new Error("Failed to create fake run");
		state.activeRun = createdRun;

		const complete = () => {
			if (state.activeRun !== createdRun) return;
			void this.publishFakeExtensionUi(state, request.message);
			const assistantMessage = createFakeAssistantMessage("Fake reply.");
			this.emit(handle, {
				type: "message_update",
				message: assistantMessage,
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "Fake reply.",
					partial: assistantMessage,
				},
			});
			this.emit(handle, {
				type: "tool_execution_start",
				toolCallId: "fake-tool-1",
				toolName: "fakeTool",
				args: {},
			});
			this.emit(handle, {
				type: "tool_execution_update",
				toolCallId: "fake-tool-1",
				toolName: "fakeTool",
				args: {},
				partialResult: "fake output",
			});
			this.emit(handle, {
				type: "tool_execution_end",
				toolCallId: "fake-tool-1",
				toolName: "fakeTool",
				result: "fake done",
				isError: false,
			});
			state.entries = [
				...state.entries,
				{ id: `fake-user-${state.entries.length + 1}`, kind: "user", text: request.message },
				{ id: `fake-assistant-${state.entries.length + 2}`, kind: "assistant", text: "Fake reply." },
			];
			settleActiveRun(state, createdRun, "resolve");
		};

		if (request.message === FAKE_RUNTIME_PROMPTS.delay) {
			createdRun.timer = setTimeout(complete, 30_000);
		} else {
			createdRun.timer = setTimeout(complete, 0);
		}

		return { completion };
	}

	subscribe(handle: RuntimeSessionHandle, listener: (event: RuntimeSessionEvent) => void): () => void {
		const state = this.requireState(handle);
		state.listeners.add(listener);
		return () => {
			state.listeners.delete(listener);
		};
	}

	private emit(handle: RuntimeSessionHandle, event: RuntimeSessionEvent): void {
		for (const listener of this.requireState(handle).listeners) listener(event);
	}

	private requireState(handle: RuntimeSessionHandle): FakeRuntimeState {
		const state = this.states.get(handle.key);
		if (state) return state;
		throw new Error(`Fake session runtime ${handle.key} is not open`);
	}

	private async publishFakeExtensionUi(state: FakeRuntimeState, message: string): Promise<void> {
		const context = state.extensionUiContext;
		if (!context) return;
		if (message === FAKE_RUNTIME_PROMPTS.confirm) {
			void context.confirm("Fake confirm", "Confirm fake extension action?");
			return;
		}
		if (message === FAKE_RUNTIME_PROMPTS.input) {
			void context.input("Fake input", "Fake value");
			return;
		}
		if (message === FAKE_RUNTIME_PROMPTS.select) {
			void context.select("Fake select", ["choice-a", "choice-b"]);
			return;
		}
		if (message === FAKE_RUNTIME_PROMPTS.editor) {
			void context.editor("Fake editor", "initial editor text");
			return;
		}
		if (message === FAKE_RUNTIME_PROMPTS.compatibilityIssue) {
			context.setWorkingVisible(true);
		}
	}
}

function settleActiveRun(
	state: FakeRuntimeState,
	activeRun: FakeActiveRun,
	mode: "resolve" | "reject",
	error?: unknown,
): void {
	if (state.activeRun !== activeRun) return;
	if (activeRun.timer) clearTimeout(activeRun.timer);
	state.activeRun = undefined;
	if (mode === "resolve") {
		activeRun.resolve();
		return;
	}
	activeRun.reject(error);
}

function createFakeRuntime(state: FakeRuntimeState): ManagedAgentRuntime {
	const session: RuntimeAgentSession = {
		abort: async () => undefined,
		bindExtensions: async () => undefined,
		getAvailableThinkingLevels: () => ["off"],
		prompt: async () => undefined,
		setModel: async () => undefined,
		setThinkingLevel: () => undefined,
		supportsThinking: () => false,
		subscribe: (listener) => {
			state.listeners.add(listener);
			return () => {
				state.listeners.delete(listener);
			};
		},
		thinkingLevel: "off",
	};
	return {
		session,
		dispose: async () => undefined,
	};
}

function deriveSessionId(sessionFilePath: string): SessionId {
	const match = /([^/\\]+)\.jsonl$/.exec(sessionFilePath);
	if (!match) {
		throw new Error(`Fake session path must end with a .jsonl session file: ${sessionFilePath}`);
	}
	const fileStem = match[1];
	return sessionIdFromString(fileStem.slice(fileStem.lastIndexOf("_") + 1));
}

function createFakeAssistantMessage(
	text: string,
): Extract<
	Extract<RuntimeSessionEvent, { type: "message_update" }>["assistantMessageEvent"],
	{ type: "text_delta" }
>["partial"] {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "chat_completions",
		provider: "openai",
		model: "fake/model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cacheWrite1h: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.UTC(2026, 0, 1),
	};
}
