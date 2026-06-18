import { describe, expect, test, vi } from "vitest";
import {
	SessionRuntimeCloseFailed,
	SessionRuntimeOpenFailed,
	SessionTranscriptReadFailed,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../../src/contracts/index.ts";
import { PiSdkSessionDriver } from "../../../src/main/session/pi-sdk-session-driver.ts";

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
				runtime: { dispose, session: { sessionManager } },
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
					runtime: { dispose: vi.fn(), session: { sessionManager } },
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
				session: { bindExtensions: vi.fn() },
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
});
