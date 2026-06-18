import { describe, expect, test, vi } from "vitest";
import {
	SessionRuntimeCloseFailed,
	SessionRuntimeOpenFailed,
	SessionTranscriptReadFailed,
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
});

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
