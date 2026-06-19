import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	type AgentSessionEvent,
	type AgentSessionServices,
	type ExtensionUIContext,
	type CreateAgentSessionRuntimeFactory,
	type Api,
	type Model,
	type PromptOptions,
	type SessionManager,
	type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	SessionRuntimeBindFailed,
	SessionRuntimeCreateFailed,
	sessionIdFromString,
	type SessionId,
	type WorkspaceId,
	type ThinkingLevel,
} from "../../contracts/index.ts";

export interface RuntimeSessionManager {
	getSessionId(): string;
}

export interface RuntimeAgentSession {
	abort(): Promise<void>;
	bindExtensions(bindings: {
		mode: "rpc";
		uiContext?: ExtensionUIContext;
		onError?: (error: unknown) => void;
	}): Promise<void>;
	clearQueue(): { steering: string[]; followUp: string[] };
	compact?(customInstructions?: string): Promise<{
		firstKeptEntryId: string;
		summary: string;
		tokensBefore: number;
	}>;
	followUpMode: "all" | "one-at-a-time";
	getAvailableThinkingLevels(): ThinkingLevel[];
	getCommands?(): SlashCommandInfo[];
	getFollowUpMessages(): readonly string[];
	getSteeringMessages(): readonly string[];
	model?: RuntimeModel;
	navigateTree?(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: { id: string } }>;
	prompt(text: string, options?: PromptOptions): Promise<void>;
	abortCompaction?(): void;
	abortBranchSummary?(): void;
	sessionManager?: RuntimeSessionManager;
	setModel(model: RuntimeModel): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	steeringMode: "all" | "one-at-a-time";
	supportsThinking(): boolean;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	thinkingLevel: ThinkingLevel;
}

export interface ManagedAgentRuntime {
	session: RuntimeAgentSession;
	services?: RuntimeAgentServices;
	cwd?: string;
	dispose(): Promise<void>;
}

export interface RuntimeAgentServices {
	modelRegistry?: Pick<AgentSessionServices["modelRegistry"], "find" | "getAll" | "hasConfiguredAuth">;
}

export type RuntimeModel = Model<Api>;

export interface RuntimeCreateRequest {
	cwd: string;
	sessionFilePath?: string;
	sessionManager: RuntimeSessionManager;
	workspaceId?: WorkspaceId;
}

export interface RuntimeCreateResult {
	runtime: ManagedAgentRuntime;
	sessionId: SessionId;
}

export interface RuntimeSupervisorOptions {
	createRuntime?: (options: {
		cwd: string;
		agentDir: string;
		sessionManager: RuntimeSessionManager;
	}) => Promise<ManagedAgentRuntime>;
	createExtensionUiContext?: (workspaceId: WorkspaceId, sessionId: SessionId) => ExtensionUIContext;
	getAgentDir?: () => string;
}

export class RuntimeSupervisor {
	private readonly createManagedRuntime: NonNullable<RuntimeSupervisorOptions["createRuntime"]>;
	private readonly createExtensionUiContext: RuntimeSupervisorOptions["createExtensionUiContext"];
	private readonly resolveAgentDir: NonNullable<RuntimeSupervisorOptions["getAgentDir"]>;

	constructor(options: RuntimeSupervisorOptions = {}) {
		this.createManagedRuntime = options.createRuntime ?? createDefaultRuntime;
		this.createExtensionUiContext = options.createExtensionUiContext;
		this.resolveAgentDir = options.getAgentDir ?? getAgentDir;
	}

	async createRuntime(request: RuntimeCreateRequest): Promise<RuntimeCreateResult> {
		let runtime: ManagedAgentRuntime;
		try {
			runtime = await this.createManagedRuntime({
				cwd: request.cwd,
				agentDir: this.resolveAgentDir(),
				sessionManager: request.sessionManager,
			});
		} catch (error) {
			throw new SessionRuntimeCreateFailed({
				workspaceId: request.workspaceId,
				sessionId: sessionIdFromString(request.sessionManager.getSessionId()),
				sessionFilePath: request.sessionFilePath,
				message: "Failed to create Pi session runtime",
				cause: getErrorMessage(error),
			});
		}

		try {
			const sessionId = sessionIdFromString(request.sessionManager.getSessionId());
			await runtime.session.bindExtensions({
				mode: "rpc",
				...(request.workspaceId && this.createExtensionUiContext
					? { uiContext: this.createExtensionUiContext(request.workspaceId, sessionId) }
					: {}),
				onError: () => undefined,
			});
		} catch (error) {
			await disposeRuntime(runtime);
			throw new SessionRuntimeBindFailed({
				workspaceId: request.workspaceId,
				sessionId: sessionIdFromString(request.sessionManager.getSessionId()),
				sessionFilePath: request.sessionFilePath,
				message: "Failed to bind Pi session extensions",
				cause: getErrorMessage(error),
			});
		}

		return {
			runtime,
			sessionId: sessionIdFromString(request.sessionManager.getSessionId()),
		};
	}
}

const createDefaultRuntimeFactory: CreateAgentSessionRuntimeFactory = async (options) => {
	const services = await createAgentSessionServices({
		cwd: options.cwd,
		agentDir: options.agentDir,
	});
	const created = await createAgentSessionFromServices({
		services,
		sessionManager: options.sessionManager,
		sessionStartEvent: options.sessionStartEvent,
	});
	return {
		...created,
		services,
		diagnostics: services.diagnostics,
	};
};

async function createDefaultRuntime(options: {
	cwd: string;
	agentDir: string;
	sessionManager: RuntimeSessionManager;
}): Promise<ManagedAgentRuntime> {
	return createAgentSessionRuntime(createDefaultRuntimeFactory, {
		cwd: options.cwd,
		agentDir: options.agentDir,
		sessionManager: options.sessionManager as SessionManager,
	});
}

async function disposeRuntime(runtime: ManagedAgentRuntime): Promise<void> {
	try {
		await runtime.dispose();
	} catch {
		return;
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
