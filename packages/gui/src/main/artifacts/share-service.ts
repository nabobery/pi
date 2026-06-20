import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getShareViewerUrl } from "@earendil-works/pi-coding-agent/runtime";
import {
	isAllowedExternalArtifactUrl,
	SessionShareAuthFailed,
	SessionShareFailed,
	SessionShareUnavailable,
	type SessionId,
	type SessionShareSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";

const SHARE_COMMAND_TIMEOUT_MS = 30_000;
const MAX_SHARE_COMMAND_OUTPUT_BYTES = 64 * 1024;

export interface ShareCommandResult {
	code: number | null;
	errorCode?: string;
	stderr: string;
	stdout: string;
	timedOut?: boolean;
}

export type ShareCommandRunner = (command: string, args: readonly string[]) => Promise<ShareCommandResult>;

export interface ShareServiceOptions {
	runCommand?: ShareCommandRunner;
	trackExternal(url: string): string;
}

export class ShareService {
	private readonly runCommand: ShareCommandRunner;
	private readonly trackExternal: (url: string) => string;

	constructor(options: ShareServiceOptions) {
		this.runCommand = options.runCommand ?? runProcess;
		this.trackExternal = options.trackExternal;
	}

	async share(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		exportHtml(outputPath: string): Promise<string>;
	}): Promise<SessionShareSnapshot & { artifactId: string }> {
		const auth = await this.runCommand("gh", ["auth", "status"]);
		if (auth.errorCode === "ENOENT") {
			throw new SessionShareUnavailable({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				message: "GitHub CLI is not available",
			});
		}
		if (auth.code !== 0) {
			throw new SessionShareAuthFailed({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				message: "GitHub CLI is not logged in",
				cause: auth.stderr.trim() || auth.stdout.trim() || undefined,
			});
		}
		const tmpFile = join(tmpdir(), `pi-gui-share-${randomUUID()}.html`);
		try {
			await request.exportHtml(tmpFile);
			const gist = await this.runCommand("gh", ["gist", "create", tmpFile]);
			if (gist.errorCode === "ENOENT") {
				throw new SessionShareUnavailable({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					message: "GitHub CLI is not available",
				});
			}
			if (gist.code !== 0) {
				throw new SessionShareFailed({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					message: gist.timedOut ? "Timed out creating GitHub gist" : "Failed to create GitHub gist",
					cause: gist.stderr.trim() || gist.stdout.trim() || undefined,
				});
			}
			const gistUrl = gist.stdout.trim();
			const gistId = parseGistId(gistUrl);
			if (!gistId) {
				throw new SessionShareFailed({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					message: "Failed to parse GitHub gist URL",
					cause: gistUrl,
				});
			}
			const previewUrl = getShareViewerUrl(gistId);
			if (!isAllowedExternalArtifactUrl(previewUrl)) {
				throw new SessionShareFailed({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					message: "Share preview URL is not allowed",
					cause: previewUrl,
				});
			}
			return {
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				gistUrl,
				previewUrl,
				createdAt: new Date().toISOString(),
				artifactId: this.trackExternal(previewUrl),
			};
		} finally {
			await rm(tmpFile, { force: true });
		}
	}
}

function parseGistId(gistUrl: string): string | undefined {
	let url: URL;
	try {
		url = new URL(gistUrl);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.hostname !== "gist.github.com") return undefined;
	const gistId = url.pathname.split("/").filter(Boolean).at(-1);
	return gistId && gistId.length > 0 ? gistId : undefined;
}

function runProcess(command: string, args: readonly string[]): Promise<ShareCommandResult> {
	return new Promise((resolve) => {
		const child = spawn(command, [...args]);
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			resolve({ code: 1, stdout, stderr, timedOut: true });
		}, SHARE_COMMAND_TIMEOUT_MS);
		const settle = (result: ShareCommandResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		child.stdout?.on("data", (chunk) => {
			stdout = appendBounded(stdout, chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = appendBounded(stderr, chunk);
		});
		child.on("error", (error) => {
			settle({
				code: 1,
				errorCode: "code" in error && typeof error.code === "string" ? error.code : undefined,
				stdout,
				stderr: error.message,
			});
		});
		child.on("close", (code) => {
			settle({ code, stdout, stderr });
		});
	});
}

function appendBounded(current: string, chunk: unknown): string {
	const next = `${current}${String(chunk)}`;
	if (Buffer.byteLength(next, "utf-8") <= MAX_SHARE_COMMAND_OUTPUT_BYTES) return next;
	return next.slice(0, MAX_SHARE_COMMAND_OUTPUT_BYTES);
}
