import { describe, expect, test, vi } from "vitest";
import type { Api, Model } from "@earendil-works/pi-coding-agent/runtime";
import {
	ResourceInventoryReadFailed,
	ResourceReloadFailed,
	SessionCompactFailed,
	SessionCompactionNotActive,
	SessionExportUnavailable,
	SessionModelAuthUnavailable,
	SessionModelNotFound,
	SessionQueueRestoreFailed,
	SessionRuntimeCloseFailed,
	SessionRuntimeOpenFailed,
	SessionThinkingSetFailed,
	SessionTranscriptReadFailed,
	SessionTreeLabelUpdateFailed,
	SessionTreeNavigationFailed,
	SessionTreeUnavailable,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../../src/contracts/index.ts";
import { PiSdkSessionDriver } from "../../../src/main/session/pi-sdk-session-driver.ts";
import type { RuntimeSessionEvent, RuntimeSessionHandle } from "../../../src/main/session/session-driver.ts";

describe("PiSdkSessionDriver", () => {
	test("opens, snapshots, and closes runtime handles", async () => {
		const getEntries = vi.fn(() => [{ id: "entry-1", message: { role: "user", content: "hello" } }]);
		const sessionManager = {
			getCwd: () => "/tmp/workspace",
			getEntries,
			getSessionFile: () => "/tmp/sessions/session-1.jsonl",
			getSessionId: () => "session-1",
		};
		const dispose = vi.fn().mockResolvedValue(undefined);
		const runtimeSupervisor = {
			createRuntime: vi.fn().mockResolvedValue({
				runtime: { dispose, session: createRuntimeSession({ sessionManager }) },
				sessionId: sessionIdFromString("session-1"),
			}),
		};
		const openSessionManager = vi.fn(() => sessionManager);
		const driver = new PiSdkSessionDriver({
			openSessionManager,
			runtimeSupervisor,
		});
		const workspaceId = workspaceIdFromString("workspace-1");

		const handle = await driver.openSession({
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			workspaceId,
			workspacePath: "/tmp/workspace",
		});
		const snapshot = await driver.getTranscript(handle);
		await driver.closeSession(handle);

		expect(runtimeSupervisor.createRuntime).toHaveBeenCalledWith({
			cwd: "/tmp/workspace",
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			sessionManager,
			workspaceId,
		});
		expect(openSessionManager).toHaveBeenCalledWith("/tmp/sessions/session-1.jsonl", undefined, "/tmp/workspace");
		expect(handle).toMatchObject({
			key: "workspace-1:session-1",
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			sessionId: "session-1",
			workspaceId: "workspace-1",
		});
		expect(snapshot).toEqual({
			workspaceId,
			sessionId: "session-1",
			entries: [{ id: "entry-1", kind: "user", text: "hello" }],
		});
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	test("opens existing runtime handles from a session file", async () => {
		const sessionManager = {
			ensureSessionFile: vi.fn(() => "/tmp/sessions/session-1.jsonl"),
			getCwd: () => "/tmp/workspace",
			getEntries: () => [],
			getSessionFile: () => "/tmp/sessions/session-1.jsonl",
			getSessionId: () => "session-1",
		};
		const openSessionManager = vi.fn(() => sessionManager);
		const driver = new PiSdkSessionDriver({
			openSessionManager,
			runtimeSupervisor: {
				createRuntime: vi.fn().mockResolvedValue({
					runtime: { dispose: vi.fn(), session: createRuntimeSession({ sessionManager }) },
					sessionId: sessionIdFromString("session-1"),
				}),
			},
		});

		const handle = await driver.openSession({
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
		});

		expect(openSessionManager).toHaveBeenCalledWith("/tmp/sessions/session-1.jsonl", undefined, "/tmp/workspace");
		expect(handle.sessionId).toBe(sessionIdFromString("session-1"));
	});

	test("maps open failures with workspace and session file context", async () => {
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(() => {
				throw new Error("open failed");
			}),
		});

		await expect(
			driver.openSession({
				sessionFilePath: "/tmp/sessions/session-1.jsonl",
				workspaceId: workspaceIdFromString("workspace-1"),
				workspacePath: "/tmp/workspace",
			}),
		).rejects.toMatchObject({
			_tag: "SessionRuntimeOpenFailed",
			workspaceId: "workspace-1",
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			cause: "open failed",
		} satisfies Partial<SessionRuntimeOpenFailed>);
	});

	test("maps close and transcript failures with known runtime context", async () => {
		const handle = {
			key: "workspace-1:session-1",
			runtime: {
				dispose: vi.fn().mockRejectedValue(new Error("dispose failed")),
				session: createRuntimeSession(),
			},
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			sessionId: sessionIdFromString("session-1"),
			sessionManager: {
				getEntries: vi.fn(() => {
					throw new Error("read failed");
				}),
				getSessionId: () => "session-1",
			},
			workspaceId: workspaceIdFromString("workspace-1"),
			workspacePath: "/tmp/workspace",
		};
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		await expect(driver.closeSession(handle)).rejects.toMatchObject({
			_tag: "SessionRuntimeCloseFailed",
			workspaceId: "workspace-1",
			sessionId: "session-1",
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			cause: "dispose failed",
		} satisfies Partial<SessionRuntimeCloseFailed>);
		await expect(driver.getTranscript(handle)).rejects.toMatchObject({
			_tag: "SessionTranscriptReadFailed",
			workspaceId: "workspace-1",
			sessionId: "session-1",
			sessionFilePath: "/tmp/sessions/session-1.jsonl",
			cause: "read failed",
		} satisfies Partial<SessionTranscriptReadFailed>);
	});

	test("returns after prompt preflight acceptance while prompt completion continues asynchronously", async () => {
		let preflight: ((success: boolean) => void) | undefined;
		const prompt = vi.fn((_message: string, options?: unknown) => {
			preflight = getPreflightResult(options);
			return Promise.resolve();
		});
		const handle = createRuntimeHandle({ prompt });
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		const resultPromise = driver.sendMessage(handle, { message: "hello" });
		preflight?.(true);
		const result = await resultPromise;

		expect(prompt).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({ source: "rpc", preflightResult: expect.any(Function) }),
		);
		await expect(result.completion).resolves.toBeUndefined();
	});

	test("rejects prompt send when Pi preflight rejects before acceptance", async () => {
		let preflight: ((success: boolean) => void) | undefined;
		const prompt = vi.fn((_message: string, options?: unknown) => {
			preflight = getPreflightResult(options);
			return Promise.reject(new Error("missing key"));
		});
		const handle = createRuntimeHandle({ prompt });
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		const resultPromise = driver.sendMessage(handle, { message: "hello" });
		preflight?.(false);

		await expect(resultPromise).rejects.toMatchObject({ _tag: "SessionPromptRejected", cause: "missing key" });
	});

	test("passes explicit delivery mode to prompt and aborts active runs", async () => {
		const prompt = vi.fn((_message: string, options?: unknown) => {
			getPreflightResult(options)?.(true);
			return Promise.resolve();
		});
		const abort = vi.fn().mockResolvedValue(undefined);
		const handle = createRuntimeHandle({ abort, prompt });
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		await driver.sendMessage(handle, { message: "steer", deliveryMode: "steer" });
		await driver.cancelRun(handle);

		expect(prompt).toHaveBeenCalledWith(
			"steer",
			expect.objectContaining({ streamingBehavior: "steer", source: "rpc" }),
		);
		expect(abort).toHaveBeenCalledTimes(1);
	});

	test("subscribes to runtime session events", () => {
		let sessionListener: ((event: RuntimeSessionEvent) => void) | undefined;
		const unsubscribe = vi.fn();
		const subscribe = vi.fn((nextListener: (event: RuntimeSessionEvent) => void) => {
			sessionListener = nextListener;
			return unsubscribe;
		});
		const handle = createRuntimeHandle({ subscribe });
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});
		const listener = vi.fn();

		const cleanup = driver.subscribe(handle, listener);
		sessionListener?.({ type: "queue_update", steering: ["a"], followUp: [] });
		cleanup();

		expect(listener).toHaveBeenCalledWith({ type: "queue_update", steering: ["a"], followUp: [] });
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	test("uses model-specific supported thinking levels in model snapshots", async () => {
		const model = createModel({
			id: "reasoning-model",
			reasoning: true,
			thinkingLevelMap: { minimal: null, xhigh: "max" },
		});
		const registry = {
			find: vi.fn(() => model),
			getAll: vi.fn(() => [model]),
			hasConfiguredAuth: vi.fn(() => true),
		};
		const handle = createRuntimeHandle({});
		handle.runtime.services = { modelRegistry: registry };
		handle.runtime.session.model = model;
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		const snapshot = await driver.getModelThinking(handle);

		expect(snapshot.models[0]).toMatchObject({
			modelId: "reasoning-model",
			availableThinkingLevels: ["off", "low", "medium", "high", "xhigh"],
		});
	});

	test("projects queue, slash commands, exports, tree navigation, compaction, and labels", async () => {
		const handle = createRuntimeHandle({});
		handle.sessionManager.getEntries = vi.fn(() => [
			{ id: "assistant-1", message: { role: "assistant", content: "done" } },
		]);
		handle.sessionManager.getTree = vi.fn(() => [
			{
				entry: { uuid: "user-1", type: "message", role: "user", content: "hello" },
				children: [
					{ entry: { uuid: "assistant-1", type: "message", role: "assistant", content: "done" }, children: [] },
				],
			},
		]);
		handle.sessionManager.getLeafId = vi.fn(() => "assistant-1");
		handle.sessionManager.getLabel = vi.fn((entryId) => (entryId === "user-1" ? "start" : undefined));
		handle.sessionManager.appendLabelChange = vi.fn(() => "label-entry");
		handle.runtime.session.getSteeringMessages = vi.fn(() => ["steer"]);
		handle.runtime.session.getFollowUpMessages = vi.fn(() => ["follow"]);
		handle.runtime.session.getCommands = vi.fn(() => [
			{
				name: "prompt",
				description: "Prompt",
				source: "prompt" as const,
				sourceInfo: {
					path: "/tmp/prompt.md",
					source: "prompt",
					scope: "project" as const,
					origin: "top-level" as const,
				},
			},
			{
				name: "tool",
				source: "extension" as const,
				sourceInfo: { path: "/tmp/ext", source: "ext", scope: "project" as const, origin: "top-level" as const },
			},
		]);
		handle.runtime.session.navigateTree = vi.fn(async () => ({
			aborted: true,
			cancelled: false,
			editorText: "draft",
			summaryEntry: { id: "summary-1" },
		}));
		handle.runtime.session.compact = vi.fn(async () => ({
			firstKeptEntryId: "assistant-1",
			summary: "summary",
			tokensBefore: 100,
		}));
		handle.runtime.session.exportToHtml = vi.fn(async (outputPath?: string) => outputPath ?? "/tmp/session.html");
		handle.runtime.session.exportToJsonl = vi.fn((outputPath?: string) => outputPath ?? "/tmp/session.jsonl");
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		await expect(driver.getQueue(handle)).resolves.toMatchObject({ steeringCount: 1, followUpCount: 1 });
		await expect(driver.getSlashCommands(handle)).resolves.toEqual([
			expect.objectContaining({ availability: "insertOnly", name: "prompt" }),
			expect.objectContaining({ availability: "sendable", name: "tool" }),
		]);
		await expect(driver.getTree(handle)).resolves.toMatchObject({ leafEntryId: "assistant-1" });
		await expect(
			driver.navigateTree(handle, { targetEntryId: "user-1", summaryMode: "custom", customInstructions: "keep" }),
		).resolves.toMatchObject({
			aborted: true,
			clearsComposer: false,
			editorText: "draft",
			summaryEntryId: "summary-1",
		});
		await expect(driver.setTreeEntryLabel(handle, "user-1", " label ")).resolves.toMatchObject({
			leafEntryId: "assistant-1",
		});
		await expect(driver.compact(handle, "custom")).resolves.toMatchObject({
			firstKeptEntryId: "assistant-1",
			summary: "summary",
			tokensBefore: 100,
		});
		await expect(
			driver.exportSession(handle, { format: "html", outputPath: "/tmp/out.html" }),
		).resolves.toMatchObject({
			format: "html",
			outputPath: "/tmp/out.html",
		});
		await expect(driver.exportSession(handle, { format: "jsonl" })).resolves.toMatchObject({
			format: "jsonl",
			outputPath: "/tmp/session.jsonl",
		});
	});

	test("maps runtime adapter failures for tree, export, compaction, queue, resources, and thinking", async () => {
		const handle = createRuntimeHandle({});
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		await expect(driver.getTree(handle)).rejects.toBeInstanceOf(SessionTreeUnavailable);
		await expect(
			driver.navigateTree(handle, { targetEntryId: "entry-1", summaryMode: "none" }),
		).rejects.toBeInstanceOf(SessionTreeNavigationFailed);
		await expect(driver.setTreeEntryLabel(handle, "entry-1", "label")).rejects.toBeInstanceOf(
			SessionTreeLabelUpdateFailed,
		);
		await expect(driver.compact(handle, undefined)).rejects.toBeInstanceOf(SessionCompactFailed);
		await expect(driver.exportSession(handle, { format: "html" })).rejects.toBeInstanceOf(SessionExportUnavailable);
		await expect(driver.cancelCompaction(handle)).rejects.toBeInstanceOf(SessionCompactionNotActive);
		await expect(driver.cancelTreeNavigation(handle)).rejects.toBeInstanceOf(SessionTreeNavigationFailed);
		await expect(driver.getResourceInventory(handle)).rejects.toBeInstanceOf(ResourceInventoryReadFailed);
		await expect(driver.reloadResources(handle)).rejects.toBeInstanceOf(ResourceReloadFailed);

		handle.runtime.session.clearQueue = vi.fn(() => {
			throw new Error("queue failed");
		});
		await expect(driver.restoreQueuedMessages(handle)).rejects.toBeInstanceOf(SessionQueueRestoreFailed);

		handle.runtime.session.setThinkingLevel = vi.fn(() => {
			throw new Error("thinking failed");
		});
		await expect(driver.setThinkingLevel(handle, "high")).rejects.toBeInstanceOf(SessionThinkingSetFailed);
	});

	test("sets models only when registry and auth allow it", async () => {
		const model = createModel({ id: "model-a", provider: "openai", reasoning: true });
		const handle = createRuntimeHandle({});
		const driver = new PiSdkSessionDriver({
			openSessionManager: vi.fn(),
			runtimeSupervisor: { createRuntime: vi.fn() },
		});

		await expect(driver.setModel(handle, "openai", "model-a")).rejects.toBeInstanceOf(SessionModelNotFound);
		handle.runtime.services = {
			modelRegistry: {
				find: vi.fn(() => undefined),
				getAll: vi.fn(() => [model]),
				hasConfiguredAuth: vi.fn(() => true),
			},
		};
		await expect(driver.setModel(handle, "openai", "model-a")).rejects.toBeInstanceOf(SessionModelNotFound);
		handle.runtime.services.modelRegistry = {
			find: vi.fn(() => model),
			getAll: vi.fn(() => [model]),
			hasConfiguredAuth: vi.fn(() => false),
		};
		await expect(driver.setModel(handle, "openai", "model-a")).rejects.toBeInstanceOf(SessionModelAuthUnavailable);
		handle.runtime.services.modelRegistry = {
			find: vi.fn(() => model),
			getAll: vi.fn(() => [model]),
			hasConfiguredAuth: vi.fn(() => true),
		};

		const snapshot = await driver.setModel(handle, "openai", "model-a");

		expect(handle.runtime.session.setModel).toHaveBeenCalledWith(model);
		expect(snapshot.models[0]).toMatchObject({ authAvailable: true, modelId: "model-a", supportsThinking: true });
	});
});

function createModel(overrides: Partial<Model<Api>>): Model<Api> {
	return {
		api: "openai-responses",
		baseUrl: "https://example.test",
		contextWindow: 128000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		id: "model",
		input: ["text"],
		maxTokens: 4096,
		name: "Model",
		provider: "openai",
		reasoning: false,
		...overrides,
	};
}

function createRuntimeHandle(overrides: {
	abort?: () => Promise<void>;
	prompt?: (message: string, options?: unknown) => Promise<void>;
	subscribe?: (listener: (event: RuntimeSessionEvent) => void) => () => void;
}): RuntimeSessionHandle {
	return {
		key: "workspace-1:session-1",
		runtime: {
			dispose: vi.fn(),
			session: {
				abort: overrides.abort ?? vi.fn().mockResolvedValue(undefined),
				bindExtensions: vi.fn(),
				clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
				followUpMode: "all",
				getAvailableThinkingLevels: vi.fn(() => ["off" as const]),
				getFollowUpMessages: vi.fn(() => []),
				getSteeringMessages: vi.fn(() => []),
				thinkingLevel: "off" as const,
				setModel: vi.fn(async () => undefined),
				setThinkingLevel: vi.fn(),
				steeringMode: "all",
				supportsThinking: vi.fn(() => false),
				prompt: overrides.prompt ?? vi.fn().mockResolvedValue(undefined),
				subscribe: overrides.subscribe ?? vi.fn(() => () => undefined),
			},
		},
		sessionFilePath: "/tmp/sessions/session-1.jsonl",
		sessionId: sessionIdFromString("session-1"),
		sessionManager: { getEntries: () => [], getSessionId: () => "session-1" },
		workspaceId: workspaceIdFromString("workspace-1"),
		workspacePath: "/tmp/workspace",
	};
}

function createRuntimeSession(
	overrides: {
		sessionManager?: RuntimeSessionHandle["sessionManager"];
	} = {},
): RuntimeSessionHandle["runtime"]["session"] {
	return {
		abort: vi.fn().mockResolvedValue(undefined),
		bindExtensions: vi.fn(),
		clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
		followUpMode: "all",
		getAvailableThinkingLevels: vi.fn(() => ["off" as const]),
		getFollowUpMessages: vi.fn(() => []),
		getSteeringMessages: vi.fn(() => []),
		thinkingLevel: "off" as const,
		setModel: vi.fn(async () => undefined),
		setThinkingLevel: vi.fn(),
		steeringMode: "all",
		supportsThinking: vi.fn(() => false),
		prompt: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(() => () => undefined),
		...(overrides.sessionManager ? { sessionManager: overrides.sessionManager } : {}),
	};
}

function getPreflightResult(options: unknown): ((success: boolean) => void) | undefined {
	if (typeof options !== "object" || !options || !("preflightResult" in options)) return undefined;
	const preflightResult = (options as { preflightResult?: unknown }).preflightResult;
	return isPreflightResult(preflightResult) ? preflightResult : undefined;
}

function isPreflightResult(value: unknown): value is (success: boolean) => void {
	return typeof value === "function";
}
