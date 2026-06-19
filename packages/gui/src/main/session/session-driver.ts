import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/runtime";
import type {
	ModelThinkingSnapshot,
	QueueRestoreSnapshot,
	QueueSnapshot,
	SessionCompactionSnapshot,
	SessionId,
	SessionTreeSnapshot,
	SlashCommandSnapshot,
	ThinkingLevel,
	TimelineSnapshot,
	TreeNavigationSnapshot,
	TreeNavigationSummaryMode,
	WorkspaceId,
} from "../../contracts/index.ts";
import type { RuntimeSessionKey } from "./session-key.ts";
import type { ManagedAgentRuntime, RuntimeSessionManager } from "./runtime-supervisor.ts";
import type { PiSessionTreeNode } from "./tree-projection.ts";

export type RuntimeSessionEvent = AgentSessionEvent;

export interface RuntimeTranscriptSessionManager extends RuntimeSessionManager {
	appendLabelChange?(targetId: string, label: string | undefined): string;
	getEntry?(id: string): unknown;
	getEntries(): readonly unknown[];
	getLabel?(id: string): string | undefined;
	getLeafId?(): string | null;
	getTree?(): readonly PiSessionTreeNode[];
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

export interface NavigateRuntimeTreeRequest {
	customInstructions?: string;
	label?: string;
	summaryMode: TreeNavigationSummaryMode;
	targetEntryId: string;
}

export interface SessionDriver {
	openSession(request: OpenRuntimeSessionRequest): Promise<RuntimeSessionHandle>;
	cancelCompaction(handle: RuntimeSessionHandle): Promise<void>;
	cancelRun(handle: RuntimeSessionHandle): Promise<void>;
	cancelTreeNavigation(handle: RuntimeSessionHandle): Promise<void>;
	closeSession(handle: RuntimeSessionHandle): Promise<void>;
	compact(handle: RuntimeSessionHandle, customInstructions: string | undefined): Promise<SessionCompactionSnapshot>;
	getModelThinking(handle: RuntimeSessionHandle): Promise<ModelThinkingSnapshot>;
	getQueue(handle: RuntimeSessionHandle): Promise<QueueSnapshot>;
	getSlashCommands?(handle: RuntimeSessionHandle): Promise<SlashCommandSnapshot[]>;
	getTree(handle: RuntimeSessionHandle): Promise<SessionTreeSnapshot>;
	getTranscript(handle: RuntimeSessionHandle): Promise<TimelineSnapshot>;
	navigateTree(handle: RuntimeSessionHandle, request: NavigateRuntimeTreeRequest): Promise<TreeNavigationSnapshot>;
	restoreQueuedMessages(handle: RuntimeSessionHandle): Promise<QueueRestoreSnapshot>;
	setModel(handle: RuntimeSessionHandle, provider: string, modelId: string): Promise<ModelThinkingSnapshot>;
	setThinkingLevel(handle: RuntimeSessionHandle, level: ThinkingLevel): Promise<ModelThinkingSnapshot>;
	setTreeEntryLabel(
		handle: RuntimeSessionHandle,
		entryId: string,
		label: string | undefined,
	): Promise<SessionTreeSnapshot>;
	sendMessage(handle: RuntimeSessionHandle, request: SendRuntimeMessageRequest): Promise<SendRuntimeMessageResult>;
	subscribe(handle: RuntimeSessionHandle, listener: (event: RuntimeSessionEvent) => void): () => void;
}
