import {
	type SessionCompactionSnapshot,
	type ModelThinkingSnapshot,
	type QueueRestoreSnapshot,
	type QueueSnapshot,
	type SessionExportSnapshot,
	type SessionId,
	type SessionTreeSnapshot,
	type SlashCommandSnapshot,
	type TimelineSnapshot,
	type TreeNavigationSnapshot,
	sessionIdFromString,
} from "../../contracts/index.ts";
import { projectQueueRestoreSnapshot, projectQueueSnapshot } from "./queue-projection.ts";
import { createRuntimeSessionKey } from "./session-key.ts";
import type {
	OpenRuntimeSessionRequest,
	RuntimeSessionEvent,
	RuntimeSessionHandle,
	SendRuntimeMessageRequest,
	SendRuntimeMessageResult,
	SessionDriver,
	NavigateRuntimeTreeRequest,
} from "./session-driver.ts";
import type { ManagedAgentRuntime, RuntimeAgentSession } from "./runtime-supervisor.ts";
import type { ExtensionHostUiService } from "./extension-host-ui-service.ts";
import { projectSessionTreeSnapshot, type PiSessionTreeNode } from "./tree-projection.ts";

interface FakeRuntimeState {
	activeRun: FakeActiveRun | undefined;
	entries: TimelineSnapshot["entries"];
	extensionUiContext?: ReturnType<ExtensionHostUiService["createContext"]>;
	followUpQueue: string[];
	labelsByEntryId: Map<string, string>;
	leafEntryId: string | null;
	listeners: Set<(event: RuntimeSessionEvent) => void>;
	steeringQueue: string[];
	tree: PiSessionTreeNode[];
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
			followUpQueue: [],
			labelsByEntryId: new Map(),
			leafEntryId: "fake-assistant-1",
			listeners: new Set(),
			steeringQueue: [],
			tree: createFakeTree(),
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
				getTree: () => state.tree,
				getLeafId: () => state.leafEntryId,
				getEntry: (id) => findFakeTreeEntry(state.tree, id),
				getLabel: (id) => state.labelsByEntryId.get(id),
				appendLabelChange: (id, label) => {
					if (!findFakeTreeEntry(state.tree, id)) throw new Error(`Entry ${id} not found`);
					if (label) state.labelsByEntryId.set(id, label);
					else state.labelsByEntryId.delete(id);
					return `fake-label-${id}`;
				},
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

	async getTree(handle: RuntimeSessionHandle): Promise<SessionTreeSnapshot> {
		const state = this.requireState(handle);
		return projectSessionTreeSnapshot({
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			leafEntryId: state.leafEntryId,
			tree: state.tree,
			getLabel: (entryId) => state.labelsByEntryId.get(entryId),
		});
	}

	async navigateTree(
		handle: RuntimeSessionHandle,
		request: NavigateRuntimeTreeRequest,
	): Promise<TreeNavigationSnapshot> {
		const state = this.requireState(handle);
		const target = findFakeTreeEntry(state.tree, request.targetEntryId);
		if (!target) throw new Error(`Entry ${request.targetEntryId} not found`);
		let editorText: string | undefined;
		if (target.type === "message" && target.role === "user") {
			editorText = typeof target.content === "string" ? target.content : "Fake user message";
			state.leafEntryId = typeof target.parentId === "string" ? target.parentId : null;
		} else {
			state.leafEntryId = request.targetEntryId;
		}
		if (request.summaryMode !== "none") {
			state.tree = [
				...state.tree,
				{
					entry: {
						id: `fake-summary-${state.tree.length + 1}`,
						parentId: state.leafEntryId,
						type: "branch_summary",
						summary: request.customInstructions ?? "Fake branch summary",
						timestamp: new Date().toISOString(),
					},
					children: [],
				},
			];
		}
		const tree = await this.getTree(handle);
		return {
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			tree,
			timeline: await this.getTranscript(handle),
			...(editorText ? { editorText } : {}),
			clearsComposer: !editorText,
			cancelled: false,
		};
	}

	async setTreeEntryLabel(
		handle: RuntimeSessionHandle,
		entryId: string,
		label: string | undefined,
	): Promise<SessionTreeSnapshot> {
		const state = this.requireState(handle);
		if (!findFakeTreeEntry(state.tree, entryId)) throw new Error(`Entry ${entryId} not found`);
		if (label?.trim()) state.labelsByEntryId.set(entryId, label.trim());
		else state.labelsByEntryId.delete(entryId);
		return this.getTree(handle);
	}

	async compact(
		handle: RuntimeSessionHandle,
		customInstructions: string | undefined,
	): Promise<SessionCompactionSnapshot> {
		const state = this.requireState(handle);
		this.emit(handle, { type: "compaction_start", reason: "manual" });
		const summary = customInstructions ? `Compacted: ${customInstructions}` : "Compacted";
		state.entries = [
			...state.entries,
			{ id: `fake-compaction-${state.entries.length + 1}`, kind: "system", text: summary },
		];
		state.tree = [
			...state.tree,
			{
				entry: {
					id: `fake-compaction-${state.tree.length + 1}`,
					parentId: state.leafEntryId,
					type: "compaction",
					summary,
					tokensBefore: 1200,
					timestamp: new Date().toISOString(),
				},
				children: [],
			},
		];
		this.emit(handle, {
			type: "compaction_end",
			reason: "manual",
			result: { firstKeptEntryId: "fake-entry-1", summary, tokensBefore: 1200 },
			aborted: false,
			willRetry: false,
		});
		return {
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			summary,
			firstKeptEntryId: "fake-entry-1",
			tokensBefore: 1200,
			timeline: await this.getTranscript(handle),
			tree: await this.getTree(handle),
			cancelled: false,
		};
	}

	async cancelCompaction(): Promise<void> {
		return;
	}

	async cancelTreeNavigation(): Promise<void> {
		return;
	}

	async exportSession(
		handle: RuntimeSessionHandle,
		request: { format: "html" | "jsonl"; outputPath?: string },
	): Promise<Omit<SessionExportSnapshot, "artifactId" | "createdAt">> {
		return {
			workspaceId: handle.workspaceId,
			sessionId: handle.sessionId,
			format: request.format,
			outputPath: request.outputPath ?? `/tmp/pi-gui-fake-session.${request.format === "html" ? "html" : "jsonl"}`,
		};
	}

	async getQueue(handle: RuntimeSessionHandle): Promise<QueueSnapshot> {
		const state = this.requireState(handle);
		return queueSnapshot(handle, state);
	}

	async getSlashCommands(): Promise<SlashCommandSnapshot[]> {
		return [
			{
				name: "fake-extension",
				description: "Run fake extension command",
				source: "extension",
				sourceInfo: fakeSourceInfo("fake-extension.ts"),
				availability: "sendable",
			},
			{
				name: "fake-prompt",
				description: "Insert fake prompt template",
				source: "prompt",
				sourceInfo: fakeSourceInfo("fake-prompt.md"),
				availability: "insertOnly",
			},
			{
				name: "skill:fake-skill",
				description: "Use fake skill",
				source: "skill",
				sourceInfo: fakeSourceInfo("fake-skill/SKILL.md"),
				availability: "sendable",
			},
		];
	}

	async restoreQueuedMessages(handle: RuntimeSessionHandle): Promise<QueueRestoreSnapshot> {
		const state = this.requireState(handle);
		const restored = { steering: [...state.steeringQueue], followUp: [...state.followUpQueue] };
		state.steeringQueue = [];
		state.followUpQueue = [];
		const queue = queueSnapshot(handle, state);
		this.emit(handle, queueEvent(state));
		return projectQueueRestoreSnapshot(handle, restored, queue);
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
			if (request.deliveryMode === "steer") {
				state.steeringQueue = [...state.steeringQueue, request.message];
			} else {
				state.followUpQueue = [...state.followUpQueue, request.message];
			}
			state.entries = [
				...state.entries,
				{ id: `fake-${state.entries.length + 1}`, kind: "user", text: request.message },
			];
			this.emit(handle, queueEvent(state));
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
		clearQueue: () => {
			const restored = { steering: [...state.steeringQueue], followUp: [...state.followUpQueue] };
			state.steeringQueue = [];
			state.followUpQueue = [];
			return restored;
		},
		compact: async (customInstructions) => ({
			firstKeptEntryId: "fake-entry-1",
			summary: customInstructions ? `Compacted: ${customInstructions}` : "Compacted",
			tokensBefore: 1200,
		}),
		followUpMode: "all",
		getAvailableThinkingLevels: () => ["off"],
		getCommands: () => [
			{
				name: "fake-extension",
				description: "Run fake extension command",
				source: "extension",
				sourceInfo: fakeSourceInfo("fake-extension.ts"),
			},
			{
				name: "fake-prompt",
				description: "Insert fake prompt template",
				source: "prompt",
				sourceInfo: fakeSourceInfo("fake-prompt.md"),
			},
			{
				name: "skill:fake-skill",
				description: "Use fake skill",
				source: "skill",
				sourceInfo: fakeSourceInfo("fake-skill/SKILL.md"),
			},
		],
		getFollowUpMessages: () => state.followUpQueue,
		getSteeringMessages: () => state.steeringQueue,
		navigateTree: async (targetId) => {
			const target = findFakeTreeEntry(state.tree, targetId);
			if (!target) throw new Error(`Entry ${targetId} not found`);
			if (target.type === "message" && target.role === "user") {
				state.leafEntryId = typeof target.parentId === "string" ? target.parentId : null;
				return { editorText: String(target.content ?? ""), cancelled: false };
			}
			state.leafEntryId = targetId;
			return { cancelled: false };
		},
		prompt: async () => undefined,
		exportToHtml: async (outputPath) => outputPath ?? "/tmp/pi-gui-fake-session.html",
		exportToJsonl: (outputPath) => outputPath ?? "/tmp/pi-gui-fake-session.jsonl",
		abortCompaction: () => undefined,
		abortBranchSummary: () => undefined,
		setModel: async () => undefined,
		setThinkingLevel: () => undefined,
		steeringMode: "all",
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

function createFakeTree(): PiSessionTreeNode[] {
	return [
		{
			entry: {
				id: "fake-user-1",
				parentId: null,
				type: "message",
				role: "user",
				content: "Fake user prompt",
				timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
			},
			children: [
				{
					entry: {
						id: "fake-assistant-1",
						parentId: "fake-user-1",
						type: "message",
						role: "assistant",
						content: [{ type: "text", text: "Fake assistant reply" }],
						timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)).toISOString(),
					},
					children: [],
				},
				{
					entry: {
						id: "fake-tool-1",
						parentId: "fake-user-1",
						type: "tool_result",
						toolName: "fakeTool",
						output: "fake output",
						timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)).toISOString(),
					},
					children: [],
				},
			],
		},
	];
}

function findFakeTreeEntry(tree: readonly PiSessionTreeNode[], entryId: string): Record<string, unknown> | undefined {
	for (const node of tree) {
		const entry = node.entry;
		if (isRecord(entry) && entry.id === entryId) return entry;
		const child = findFakeTreeEntry(node.children, entryId);
		if (child) return child;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function fakeSourceInfo(path: string) {
	return {
		path,
		source: "fake",
		scope: "temporary" as const,
		origin: "top-level" as const,
	};
}

function queueSnapshot(handle: RuntimeSessionHandle, state: FakeRuntimeState): QueueSnapshot {
	return projectQueueSnapshot(
		handle,
		{ steering: state.steeringQueue, followUp: state.followUpQueue },
		{ steeringMode: "all", followUpMode: "all" },
	);
}

function queueEvent(state: FakeRuntimeState): RuntimeSessionEvent {
	return { type: "queue_update", steering: state.steeringQueue, followUp: state.followUpQueue };
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
