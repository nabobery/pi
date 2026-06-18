import type { SessionId, TimelineSnapshot, WorkspaceId } from "../../contracts/index.ts";
import type { RuntimeSessionKey } from "./session-key.ts";
import type { ManagedAgentRuntime, RuntimeSessionManager } from "./runtime-supervisor.ts";

export interface RuntimeTranscriptSessionManager extends RuntimeSessionManager {
	getEntries(): readonly unknown[];
}

export interface RuntimeSessionHandle {
	key: RuntimeSessionKey;
	runtime: ManagedAgentRuntime;
	sessionFilePath: string | undefined;
	sessionId: SessionId;
	sessionManager: RuntimeTranscriptSessionManager;
	workspaceId: WorkspaceId;
	workspacePath: string;
}

export interface OpenRuntimeSessionRequest {
	sessionFilePath: string;
	workspaceId: WorkspaceId;
	workspacePath: string;
}

export interface SessionDriver {
	openSession(request: OpenRuntimeSessionRequest): Promise<RuntimeSessionHandle>;
	closeSession(handle: RuntimeSessionHandle): Promise<void>;
	getTranscript(handle: RuntimeSessionHandle): Promise<TimelineSnapshot>;
	subscribe(handle: RuntimeSessionHandle, listener: () => void): () => void;
}
