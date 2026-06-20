import { describe, expect, test, vi } from "vitest";
import { SessionShareAuthFailed, SessionShareFailed, SessionShareUnavailable } from "../../../src/contracts/index.ts";
import { ShareService, type ShareCommandRunner } from "../../../src/main/artifacts/share-service.ts";
import { sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");

describe("ShareService", () => {
	test("creates a secret GitHub gist and tracks the preview URL", async () => {
		const calls: { command: string; args: readonly string[] }[] = [];
		const runCommand: ShareCommandRunner = async (command, args) => {
			calls.push({ command, args });
			if (args[0] === "auth") return { code: 0, stdout: "", stderr: "" };
			return { code: 0, stdout: "https://gist.github.com/user/abc123\n", stderr: "" };
		};
		const trackExternal = vi.fn((url: string) => `artifact:${url}`);
		const service = new ShareService({ runCommand, trackExternal });

		const shared = await service.share({
			workspaceId,
			sessionId,
			exportHtml: async (outputPath) => outputPath,
		});

		expect(calls[1].args).toEqual(["gist", "create", expect.stringContaining("pi-gui-share-")]);
		expect(calls[1].args).not.toContain("--public=false");
		expect(shared.gistUrl).toBe("https://gist.github.com/user/abc123");
		expect(shared.previewUrl).toBe("https://pi.dev/session/#abc123");
		expect(trackExternal).toHaveBeenCalledWith("https://pi.dev/session/#abc123");
	});

	test("supports injected share preview URL generation", async () => {
		const runCommand: ShareCommandRunner = async (_command, args) =>
			args[0] === "auth"
				? { code: 0, stdout: "", stderr: "" }
				: { code: 0, stdout: "https://gist.github.com/user/abc123\n", stderr: "" };
		const trackExternal = vi.fn((url: string) => `artifact:${url}`);
		const service = new ShareService({
			runCommand,
			trackExternal,
			getShareViewerUrl: (gistId) => `https://share.local/session/#${gistId}`,
		});

		const shared = await service.share({
			workspaceId,
			sessionId,
			exportHtml: async (outputPath) => outputPath,
		});

		expect(shared.previewUrl).toBe("https://share.local/session/#abc123");
		expect(trackExternal).toHaveBeenCalledWith("https://share.local/session/#abc123");
	});

	test("rejects malformed generated share preview URLs", async () => {
		const runCommand: ShareCommandRunner = async (_command, args) =>
			args[0] === "auth"
				? { code: 0, stdout: "", stderr: "" }
				: { code: 0, stdout: "https://gist.github.com/user/abc123\n", stderr: "" };
		const trackExternal = vi.fn((url: string) => `artifact:${url}`);
		const service = new ShareService({
			runCommand,
			trackExternal,
			getShareViewerUrl: (gistId) => `http://share.local/session/#${gistId}`,
		});

		await expect(
			service.share({ workspaceId, sessionId, exportHtml: async (outputPath) => outputPath }),
		).rejects.toMatchObject({
			message: "Share preview URL is not allowed",
			cause: "http://share.local/session/#abc123",
		});
		expect(trackExternal).not.toHaveBeenCalled();
	});

	test("reports missing GitHub CLI as share unavailable", async () => {
		const service = new ShareService({
			runCommand: async () => ({ code: 1, errorCode: "ENOENT", stdout: "", stderr: "missing" }),
			trackExternal: (url) => url,
		});

		await expect(
			service.share({ workspaceId, sessionId, exportHtml: async (outputPath) => outputPath }),
		).rejects.toBeInstanceOf(SessionShareUnavailable);
	});

	test("reports unauthenticated GitHub CLI as auth failure", async () => {
		const service = new ShareService({
			runCommand: async () => ({ code: 1, stdout: "", stderr: "not logged in" }),
			trackExternal: (url) => url,
		});

		await expect(
			service.share({ workspaceId, sessionId, exportHtml: async (outputPath) => outputPath }),
		).rejects.toBeInstanceOf(SessionShareAuthFailed);
	});

	test("reports gist upload failures and malformed gist URLs", async () => {
		const gistFailure = new ShareService({
			runCommand: async (_command, args) =>
				args[0] === "auth" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "upload failed" },
			trackExternal: (url) => url,
		});
		await expect(
			gistFailure.share({ workspaceId, sessionId, exportHtml: async (outputPath) => outputPath }),
		).rejects.toBeInstanceOf(SessionShareFailed);

		const malformed = new ShareService({
			runCommand: async (_command, args) =>
				args[0] === "auth"
					? { code: 0, stdout: "", stderr: "" }
					: { code: 0, stdout: "https://example.com/not-a-gist", stderr: "" },
			trackExternal: (url) => url,
		});
		await expect(
			malformed.share({ workspaceId, sessionId, exportHtml: async (outputPath) => outputPath }),
		).rejects.toBeInstanceOf(SessionShareFailed);
	});

	test("reports timed out gist creation as share failure", async () => {
		const service = new ShareService({
			runCommand: async (_command, args) =>
				args[0] === "auth"
					? { code: 0, stdout: "", stderr: "" }
					: { code: 1, stdout: "", stderr: "slow", timedOut: true },
			trackExternal: (url) => url,
		});

		await expect(
			service.share({ workspaceId, sessionId, exportHtml: async (outputPath) => outputPath }),
		).rejects.toMatchObject({ message: "Timed out creating GitHub gist" });
	});
});
