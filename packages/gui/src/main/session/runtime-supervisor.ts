import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	type AgentSessionEvent,
	type CreateAgentSessionRuntimeFactory,
	type PromptOptions,
	type SessionManager,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	SessionRuntimeBindFailed,
	SessionRuntimeCreateFailed,
	sessionIdFromString,
	type SessionId,
	type WorkspaceId,
} from "../../contracts/index.ts";

export interface RuntimeSessionManager {
	getSessionId(): string;
}

export interface RuntimeAgentSession {
	abort(): Promise<void>;
	bindExtensions(bindings: { mode: "rpc"; onError?: (error: unknown) => void }): Promise<void>;
	prompt(text: string, options?: PromptOptions): Promise<void>;
	sessionManager?: RuntimeSessionManager;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}

export interface ManagedAgentRuntime {
	session: RuntimeAgentSession;
	cwd?: string;
	dispose(): Promise<void>;
}

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
	getAgentDir?: () => string;
}

export class RuntimeSupervisor {
	private readonly createManagedRuntime: NonNullable<RuntimeSupervisorOptions["createRuntime"]>;
	private readonly resolveAgentDir: NonNullable<RuntimeSupervisorOptions["getAgentDir"]>;

	constructor(options: RuntimeSupervisorOptions = {}) {
		this.createManagedRuntime = options.createRuntime ?? createDefaultRuntime;
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
			await runtime.session.bindExtensions({
				mode: "rpc",
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
