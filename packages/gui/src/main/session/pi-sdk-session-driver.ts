import { SessionManager } from "@earendil-works/pi-coding-agent/runtime";
import {
	SessionCancelFailed,
	SessionPromptRejected,
	SessionRuntimeBindFailed,
	SessionRuntimeCloseFailed,
	SessionRuntimeCreateFailed,
	SessionRuntimeOpenFailed,
	SessionTranscriptReadFailed,
	sessionIdFromString,
	type SessionId,
	type TimelineSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { createRuntimeSessionKey } from "./session-key.ts";
import { projectTimelineSnapshot } from "./timeline-projection.ts";
import type {
	OpenRuntimeSessionRequest,
	RuntimeSessionHandle,
	RuntimeTranscriptSessionManager,
	SendRuntimeMessageRequest,
	SendRuntimeMessageResult,
	SessionDriver,
} from "./session-driver.ts";
import { RuntimeSupervisor } from "./runtime-supervisor.ts";

interface DriverSessionManager extends RuntimeTranscriptSessionManager {
	getCwd(): string;
	getSessionFile(): string | undefined;
}

export interface PiSdkSessionDriverOptions {
	openSessionManager?: (path: string, sessionDir?: string, cwdOverride?: string) => DriverSessionManager;
	runtimeSupervisor?: Pick<RuntimeSupervisor, "createRuntime">;
	sessionDir?: string;
}

export class PiSdkSessionDriver implements SessionDriver {
	private readonly openSessionManager: NonNullable<PiSdkSessionDriverOptions["openSessionManager"]>;
	private readonly runtimeSupervisor: Pick<RuntimeSupervisor, "createRuntime">;
	private readonly sessionDir: string | undefined;

	constructor(options: PiSdkSessionDriverOptions = {}) {
		this.openSessionManager = options.openSessionManager ?? SessionManager.open;
		this.runtimeSupervisor = options.runtimeSupervisor ?? new RuntimeSupervisor();
		this.sessionDir = options.sessionDir;
	}

	async openSession(request: OpenRuntimeSessionRequest): Promise<RuntimeSessionHandle> {
		let sessionManager: DriverSessionManager;
		try {
			sessionManager = this.openSessionManager(request.sessionFilePath, this.sessionDir, request.workspacePath);
		} catch (error) {
			throw new SessionRuntimeOpenFailed({
				workspaceId: request.workspaceId,
				sessionFilePath: request.sessionFilePath,
				message: "Failed to open Pi session manager",
				cause: getErrorMessage(error),
			});
		}

		return this.createHandle(request.workspaceId, request.workspacePath, sessionManager, request.sessionFilePath);
	}

	async closeSession(handle: RuntimeSessionHandle): Promise<void> {
		try {
			await handle.runtime.dispose();
		} catch (error) {
			throw new SessionRuntimeCloseFailed({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				sessionFilePath: handle.sessionFilePath,
				message: "Failed to close Pi session runtime",
				cause: getErrorMessage(error),
			});
		}
	}

	async cancelRun(handle: RuntimeSessionHandle): Promise<void> {
		try {
			await handle.runtime.session.abort();
		} catch (error) {
			throw new SessionCancelFailed({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				message: "Failed to cancel Pi session run",
				cause: getErrorMessage(error),
			});
		}
	}

	async sendMessage(
		handle: RuntimeSessionHandle,
		request: SendRuntimeMessageRequest,
	): Promise<SendRuntimeMessageResult> {
		let resolvePreflight: (() => void) | undefined;
		let rejectPreflight: ((error: unknown) => void) | undefined;
		const preflight = new Promise<void>((resolve, reject) => {
			resolvePreflight = resolve;
			rejectPreflight = reject;
		});

		const completion = handle.runtime.session.prompt(request.message, {
			...(request.deliveryMode ? { streamingBehavior: request.deliveryMode } : {}),
			source: "rpc",
			preflightResult: (success) => {
				if (success) {
					resolvePreflight?.();
					return;
				}
				rejectPreflight?.(new Error("Prompt preflight rejected"));
			},
		});
		completion.catch((error: unknown) => {
			rejectPreflight?.(error);
		});

		try {
			await preflight;
		} catch (error) {
			try {
				await completion;
			} catch (completionError) {
				throw new SessionPromptRejected({
					workspaceId: handle.workspaceId,
					sessionId: handle.sessionId,
					message: "Pi rejected the prompt before starting a run",
					cause: getErrorMessage(completionError),
				});
			}
			throw new SessionPromptRejected({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				message: "Pi rejected the prompt before starting a run",
				cause: getErrorMessage(error),
			});
		}

		return { completion };
	}

	async getTranscript(handle: RuntimeSessionHandle): Promise<TimelineSnapshot> {
		try {
			return projectTimelineSnapshot(handle.workspaceId, handle.sessionId, handle.sessionManager.getEntries());
		} catch (error) {
			throw new SessionTranscriptReadFailed({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				sessionFilePath: handle.sessionFilePath,
				message: "Failed to read Pi session transcript",
				cause: getErrorMessage(error),
			});
		}
	}

	subscribe(handle: RuntimeSessionHandle, listener: Parameters<SessionDriver["subscribe"]>[1]): () => void {
		return handle.runtime.session.subscribe(listener);
	}

	private async createHandle(
		workspaceId: RuntimeSessionHandle["workspaceId"],
		workspacePath: string,
		sessionManager: DriverSessionManager,
		sessionFilePath: string | undefined,
	): Promise<RuntimeSessionHandle> {
		const sessionId = sessionIdFromString(sessionManager.getSessionId());
		let runtimeResult: Awaited<ReturnType<RuntimeSupervisor["createRuntime"]>>;
		try {
			runtimeResult = await this.runtimeSupervisor.createRuntime({
				cwd: sessionManager.getCwd(),
				sessionFilePath,
				sessionManager,
				workspaceId,
			});
		} catch (error) {
			throw enrichRuntimeError(error, workspaceId, sessionId, sessionFilePath);
		}
		return {
			key: createRuntimeSessionKey(workspaceId, sessionId),
			runtime: runtimeResult.runtime,
			sessionFilePath,
			sessionId,
			sessionManager,
			workspaceId,
			workspacePath,
		};
	}
}

function enrichRuntimeError(
	error: unknown,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	sessionFilePath: string | undefined,
): unknown {
	if (error instanceof SessionRuntimeCreateFailed) {
		return new SessionRuntimeCreateFailed({
			workspaceId,
			sessionId,
			sessionFilePath,
			message: error.message,
			cause: error.cause,
		});
	}
	if (error instanceof SessionRuntimeBindFailed) {
		return new SessionRuntimeBindFailed({
			workspaceId,
			sessionId,
			sessionFilePath,
			message: error.message,
			cause: error.cause,
		});
	}
	return error;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
