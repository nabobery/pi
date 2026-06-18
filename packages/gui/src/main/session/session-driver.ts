import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/runtime";
import type { SessionId, TimelineSnapshot, WorkspaceId } from "../../contracts/index.ts";
import type { RuntimeSessionKey } from "./session-key.ts";
import type { ManagedAgentRuntime, RuntimeSessionManager } from "./runtime-supervisor.ts";

export type RuntimeSessionEvent = AgentSessionEvent;

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

export interface SendRuntimeMessageRequest {
	message: string;
	deliveryMode?: "steer" | "followUp";
}

export interface SendRuntimeMessageResult {
	completion: Promise<void>;
}

export interface SessionDriver {
	openSession(request: OpenRuntimeSessionRequest): Promise<RuntimeSessionHandle>;
	cancelRun(handle: RuntimeSessionHandle): Promise<void>;
	closeSession(handle: RuntimeSessionHandle): Promise<void>;
	getTranscript(handle: RuntimeSessionHandle): Promise<TimelineSnapshot>;
	sendMessage(handle: RuntimeSessionHandle, request: SendRuntimeMessageRequest): Promise<SendRuntimeMessageResult>;
	subscribe(handle: RuntimeSessionHandle, listener: (event: RuntimeSessionEvent) => void): () => void;
}
