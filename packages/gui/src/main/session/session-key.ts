import type { SessionId, WorkspaceId } from "../../contracts/index.ts";

export type RuntimeSessionKey = string;

export function createRuntimeSessionKey(workspaceId: WorkspaceId, sessionId: SessionId): RuntimeSessionKey {
	return `${workspaceId}:${sessionId}`;
}
