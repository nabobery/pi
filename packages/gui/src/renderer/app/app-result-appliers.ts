import {
	decodeModelThinkingSnapshot,
	decodeQueueRestoreSnapshot,
	decodeSessionCatalogSnapshot,
	decodeSessionCompactionSnapshot,
	decodeSessionTreeSnapshot,
	decodeSettingsSummarySnapshot,
	decodeTimelineSnapshot,
	decodeTreeNavigationSnapshot,
	decodeTrustStatusSnapshot,
	decodeWorkspaceCatalogSnapshot,
	type ModelThinkingSnapshot,
	type QueueRestoreSnapshot,
	type SessionCatalogSnapshot,
	type SessionTreeSnapshot,
	type SettingsSummarySnapshot,
	type TimelineSnapshot,
	type TrustStatusSnapshot,
	type WorkspaceCatalogSnapshot,
} from "../../contracts/index.ts";
import type { CatalogViewState } from "./app-store.ts";
import { applyQueueRestore, mergeSessionCatalog, sessionKey as timelineKey } from "./session-state-projections.ts";
import { applyCompactionResult, applyNavigationResult, applyTreeEvent } from "./tree-and-compaction-store.ts";

export async function applyCommandResultData(state: CatalogViewState, data: unknown): Promise<CatalogViewState> {
	const workspaceCatalog = await decodeWorkspaceCatalog(data);
	if (workspaceCatalog) return { ...state, workspaceCatalog };
	const sessionCatalog = await decodeSessionCatalog(data);
	if (sessionCatalog) {
		return {
			...state,
			sessionCatalogs: {
				...state.sessionCatalogs,
				[sessionCatalog.workspaceId]: mergeSessionCatalog(state, sessionCatalog),
			},
		};
	}
	const timeline = await decodeTimeline(data);
	if (timeline) {
		return {
			...state,
			timelines: {
				...state.timelines,
				[timelineKey(timeline.workspaceId, timeline.sessionId)]: timeline,
			},
		};
	}
	const modelThinking = await decodeModelThinking(data);
	if (modelThinking) {
		return {
			...state,
			modelThinkingBySessionKey: {
				...state.modelThinkingBySessionKey,
				[timelineKey(modelThinking.workspaceId, modelThinking.sessionId)]: modelThinking,
			},
		};
	}
	const settingsSummary = await decodeSettingsSummary(data);
	if (settingsSummary) {
		return {
			...state,
			settingsSummaryByWorkspaceId: {
				...state.settingsSummaryByWorkspaceId,
				[settingsSummary.workspaceId]: settingsSummary,
			},
		};
	}
	const trustStatus = await decodeTrustStatus(data);
	if (trustStatus) {
		return {
			...state,
			trustStatusByWorkspaceId: {
				...state.trustStatusByWorkspaceId,
				[trustStatus.workspaceId]: trustStatus,
			},
		};
	}
	const queueRestore = await decodeQueueRestoreData(data);
	if (queueRestore) return applyQueueRestore(state, queueRestore);
	const tree = await decodeTree(data);
	if (tree) return applyTreeEvent(state, tree);
	const navigation = await decodeNavigation(data);
	if (navigation) return applyNavigationResult(state, navigation);
	const compaction = await decodeCompaction(data);
	if (compaction) return applyCompactionResult(state, compaction);
	return state;
}

export async function decodeQueueRestoreData(data: unknown): Promise<QueueRestoreSnapshot | undefined> {
	try {
		return await decodeQueueRestoreSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeWorkspaceCatalog(data: unknown): Promise<WorkspaceCatalogSnapshot | undefined> {
	try {
		return await decodeWorkspaceCatalogSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeSessionCatalog(data: unknown): Promise<SessionCatalogSnapshot | undefined> {
	try {
		return await decodeSessionCatalogSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeTimeline(data: unknown): Promise<TimelineSnapshot | undefined> {
	try {
		return await decodeTimelineSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeModelThinking(data: unknown): Promise<ModelThinkingSnapshot | undefined> {
	try {
		return await decodeModelThinkingSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeSettingsSummary(data: unknown): Promise<SettingsSummarySnapshot | undefined> {
	try {
		return await decodeSettingsSummarySnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeTrustStatus(data: unknown): Promise<TrustStatusSnapshot | undefined> {
	try {
		return await decodeTrustStatusSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeTree(data: unknown): Promise<SessionTreeSnapshot | undefined> {
	try {
		return await decodeSessionTreeSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeNavigation(data: unknown) {
	try {
		return await decodeTreeNavigationSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeCompaction(data: unknown) {
	try {
		return await decodeSessionCompactionSnapshot(data);
	} catch {
		return undefined;
	}
}
