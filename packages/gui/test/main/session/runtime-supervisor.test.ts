import { describe, expect, test, vi } from "vitest";
import { SessionRuntimeBindFailed, sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { RuntimeSupervisor } from "../../../src/main/session/runtime-supervisor.ts";

describe("RuntimeSupervisor", () => {
	test("creates a runtime and binds extensions in rpc mode", async () => {
		const bindExtensions = vi.fn().mockResolvedValue(undefined);
		const createRuntime = vi.fn().mockResolvedValue({
			session: { bindExtensions },
			dispose: vi.fn(),
		});
		const sessionManager = { getSessionId: () => "session-1" };
		const supervisor = new RuntimeSupervisor({
			createRuntime,
			getAgentDir: () => "/tmp/pi-agent",
		});

		const runtime = await supervisor.createRuntime({
			cwd: "/tmp/workspace",
			sessionManager,
		});

		expect(runtime.sessionId).toBe(sessionIdFromString("session-1"));
		expect(createRuntime).toHaveBeenCalledWith({
			cwd: "/tmp/workspace",
			agentDir: "/tmp/pi-agent",
			sessionManager,
		});
		expect(bindExtensions).toHaveBeenCalledWith(expect.objectContaining({ mode: "rpc" }));
	});

	test("disposes partial runtime state when extension binding fails", async () => {
		const dispose = vi.fn().mockResolvedValue(undefined);
		const createRuntime = vi.fn().mockResolvedValue({
			session: {
				bindExtensions: vi.fn().mockRejectedValue(new Error("bind failed")),
			},
			dispose,
		});
		const supervisor = new RuntimeSupervisor({
			createRuntime,
			getAgentDir: () => "/tmp/pi-agent",
		});

		await expect(
			supervisor.createRuntime({
				cwd: "/tmp/workspace",
				sessionFilePath: "/tmp/session.jsonl",
				sessionManager: { getSessionId: () => "session-1" },
				workspaceId: workspaceIdFromString("workspace-1"),
			}),
		).rejects.toMatchObject({
			_tag: "SessionRuntimeBindFailed",
			workspaceId: "workspace-1",
			sessionId: "session-1",
			sessionFilePath: "/tmp/session.jsonl",
			cause: "bind failed",
		} satisfies Partial<SessionRuntimeBindFailed>);
		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
