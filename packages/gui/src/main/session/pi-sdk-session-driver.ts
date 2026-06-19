import { SessionManager, getSupportedThinkingLevels } from "@earendil-works/pi-coding-agent/runtime";
import {
	SessionModelAuthUnavailable,
	SessionModelNotFound,
	SessionModelSetFailed,
	SessionCancelFailed,
	SessionPromptRejected,
	SessionQueueRestoreFailed,
	SessionRuntimeBindFailed,
	SessionRuntimeCloseFailed,
	SessionRuntimeCreateFailed,
	SessionRuntimeOpenFailed,
	SessionThinkingSetFailed,
	SessionTranscriptReadFailed,
	sessionIdFromString,
	type ModelOptionSnapshot,
	type ModelThinkingSnapshot,
	type QueueSnapshot,
	type SessionId,
	type SlashCommandSnapshot,
	type ThinkingLevel,
	type TimelineSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { createRuntimeSessionKey } from "./session-key.ts";
import { projectQueueRestoreSnapshot, projectQueueSnapshot } from "./queue-projection.ts";
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

	async getQueue(handle: RuntimeSessionHandle): Promise<QueueSnapshot> {
		return projectQueueSnapshot(
			handle,
			{
				steering: handle.runtime.session.getSteeringMessages(),
				followUp: handle.runtime.session.getFollowUpMessages(),
			},
			{
				steeringMode: handle.runtime.session.steeringMode,
				followUpMode: handle.runtime.session.followUpMode,
			},
		);
	}

	async getSlashCommands(handle: RuntimeSessionHandle): Promise<SlashCommandSnapshot[]> {
		const commands: SlashCommandSnapshot[] = [];
		for (const command of handle.runtime.session.getCommands?.() ?? []) {
			commands.push({
				name: command.name,
				...(command.description ? { description: command.description } : {}),
				source: command.source,
				sourceInfo: command.sourceInfo,
				availability: command.source === "prompt" ? "insertOnly" : "sendable",
			});
		}
		return commands;
	}

	async restoreQueuedMessages(handle: RuntimeSessionHandle) {
		try {
			const restored = handle.runtime.session.clearQueue();
			const queue = await this.getQueue(handle);
			return projectQueueRestoreSnapshot(handle, restored, queue);
		} catch (error) {
			throw new SessionQueueRestoreFailed({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				message: "Failed to restore queued Pi session messages",
				cause: getErrorMessage(error),
			});
		}
	}

	async getModelThinking(handle: RuntimeSessionHandle): Promise<ModelThinkingSnapshot> {
		return modelThinkingSnapshot(handle);
	}

	async setModel(handle: RuntimeSessionHandle, provider: string, modelId: string): Promise<ModelThinkingSnapshot> {
		const registry = handle.runtime.services?.modelRegistry;
		if (!registry) {
			throw new SessionModelNotFound({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				provider,
				modelId,
				message: "Model registry is not available",
			});
		}
		const model = registry.find(provider, modelId);
		if (!model) {
			throw new SessionModelNotFound({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				provider,
				modelId,
				message: `Model ${provider}/${modelId} is not available`,
			});
		}
		if (!registry.hasConfiguredAuth(model)) {
			throw new SessionModelAuthUnavailable({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				provider,
				modelId,
				message: `No configured auth for ${provider}/${modelId}`,
			});
		}
		try {
			await handle.runtime.session.setModel(model);
			return modelThinkingSnapshot(handle);
		} catch (error) {
			throw new SessionModelSetFailed({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				provider,
				modelId,
				message: "Failed to set Pi session model",
				cause: getErrorMessage(error),
			});
		}
	}

	async setThinkingLevel(handle: RuntimeSessionHandle, level: ThinkingLevel): Promise<ModelThinkingSnapshot> {
		try {
			handle.runtime.session.setThinkingLevel(level);
			return modelThinkingSnapshot(handle);
		} catch (error) {
			throw new SessionThinkingSetFailed({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				thinkingLevel: level,
				message: "Failed to set Pi session thinking level",
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

function modelThinkingSnapshot(handle: RuntimeSessionHandle): ModelThinkingSnapshot {
	const model = handle.runtime.session.model;
	return {
		workspaceId: handle.workspaceId,
		sessionId: handle.sessionId,
		...(model?.provider ? { provider: model.provider } : {}),
		...(model?.id ? { modelId: model.id } : {}),
		...(model?.name ? { modelName: model.name } : {}),
		thinkingLevel: handle.runtime.session.thinkingLevel,
		availableThinkingLevels: handle.runtime.session.getAvailableThinkingLevels(),
		models: modelOptions(handle),
	};
}

function modelOptions(handle: RuntimeSessionHandle): ModelOptionSnapshot[] {
	const registry = handle.runtime.services?.modelRegistry;
	if (registry) {
		return registry.getAll().map((model) => ({
			provider: model.provider,
			modelId: model.id,
			name: model.name ?? model.id,
			authAvailable: registry.hasConfiguredAuth(model),
			supportsThinking: model.reasoning === true,
			availableThinkingLevels: getSupportedThinkingLevels(model),
		}));
	}
	const model = handle.runtime.session.model;
	if (!model) return [];
	return [
		{
			provider: model.provider,
			modelId: model.id,
			name: model.name ?? model.id,
			authAvailable: true,
			supportsThinking: model.reasoning === true,
			availableThinkingLevels: handle.runtime.session.getAvailableThinkingLevels(),
		},
	];
}
