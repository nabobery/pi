import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SessionShareUnavailable, sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { ShareService } from "../../../src/main/artifacts/share-service.ts";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");

describe("ShareService default command runner", () => {
	beforeEach(() => {
		vi.mocked(spawn).mockReset();
	});

	test("uploads through mocked gh processes", async () => {
		const auth = createChildProcess();
		const gist = createChildProcess();
		vi.mocked(spawn).mockReturnValueOnce(auth.process).mockReturnValueOnce(gist.process);
		const service = new ShareService({ trackExternal: (url) => `artifact:${url}` });
		const sharedPromise = service.share({
			workspaceId,
			sessionId,
			exportHtml: async (outputPath) => outputPath,
		});

		auth.close(0);
		await settleAsyncUpdates();
		gist.stdout.write("https://gist.github.com/user/abc123\n");
		gist.close(0);

		await expect(sharedPromise).resolves.toMatchObject({
			artifactId: "artifact:https://pi.dev/session/#abc123",
			previewUrl: "https://pi.dev/session/#abc123",
		});
		expect(spawn).toHaveBeenNthCalledWith(1, "gh", ["auth", "status"]);
		expect(spawn).toHaveBeenNthCalledWith(2, "gh", ["gist", "create", expect.stringContaining("pi-gui-share-")]);
	});

	test("maps spawn ENOENT errors to missing GitHub CLI", async () => {
		const auth = createChildProcess();
		vi.mocked(spawn).mockReturnValueOnce(auth.process);
		const service = new ShareService({ trackExternal: (url) => url });
		const sharedPromise = service.share({
			workspaceId,
			sessionId,
			exportHtml: async (outputPath) => outputPath,
		});

		auth.error(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));

		await expect(sharedPromise).rejects.toBeInstanceOf(SessionShareUnavailable);
	});

	test("times out long-running gh commands", async () => {
		vi.useFakeTimers();
		try {
			const auth = createChildProcess();
			const gist = createChildProcess();
			vi.mocked(spawn).mockReturnValueOnce(auth.process).mockReturnValueOnce(gist.process);
			const service = new ShareService({ trackExternal: (url) => url });
			const sharedPromise = service.share({
				workspaceId,
				sessionId,
				exportHtml: async (outputPath) => outputPath,
			});

			auth.close(0);
			await vi.advanceTimersByTimeAsync(30_000);

			await expect(sharedPromise).rejects.toMatchObject({ message: "Timed out creating GitHub gist" });
			expect(gist.kill).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
});

function createChildProcess() {
	const emitter = new EventEmitter();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const kill = vi.fn();
	const process = Object.assign(emitter, {
		kill,
		stderr,
		stdout,
	}) as unknown as ReturnType<typeof spawn>;
	return {
		kill,
		process,
		stderr,
		stdout,
		close: (code: number) => emitter.emit("close", code),
		error: (error: Error) => emitter.emit("error", error),
	};
}

async function settleAsyncUpdates(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
