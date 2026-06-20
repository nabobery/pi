import {
	decodeModelThinkingSnapshot,
	decodeImageAttachmentListSnapshot,
	decodeQueueRestoreSnapshot,
	decodeResourceInventorySnapshot,
	decodeSessionCatalogSnapshot,
	decodeSessionCompactionSnapshot,
	decodeSessionExportResultSnapshot,
	decodeSessionShareSnapshot,
	decodeSessionTreeSnapshot,
	decodeSettingsEditorSnapshot,
	decodeSettingsSummarySnapshot,
	decodeTimelineSnapshot,
	decodeTreeNavigationSnapshot,
	decodeTrustStatusSnapshot,
	decodeWorkspaceCatalogSnapshot,
	type ModelThinkingSnapshot,
	type ImageAttachmentListSnapshot,
	type QueueRestoreSnapshot,
	type ResourceInventorySnapshot,
	type SessionCatalogSnapshot,
	type SessionExportResultSnapshot,
	type SessionExportSnapshot,
	type SessionShareSnapshot,
	type SessionTreeSnapshot,
	type SettingsEditorSnapshot,
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
	const imageAttachments = await decodeImageAttachments(data);
	if (imageAttachments) {
		return {
			...state,
			imageAttachmentsBySessionKey: {
				...state.imageAttachmentsBySessionKey,
				[timelineKey(imageAttachments.workspaceId, imageAttachments.sessionId)]: imageAttachments,
			},
		};
	}
	const exported = await decodeExport(data);
	if (exported) {
		return {
			...state,
			exportsBySessionKey: {
				...state.exportsBySessionKey,
				[timelineKey(exported.workspaceId, exported.sessionId)]: exported,
			},
		};
	}
	const shared = await decodeShare(data);
	if (shared) {
		return {
			...state,
			sharesBySessionKey: {
				...state.sharesBySessionKey,
				[timelineKey(shared.workspaceId, shared.sessionId)]: shared,
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
	const settingsEditor = await decodeSettingsEditor(data);
	if (settingsEditor) {
		return {
			...state,
			settingsEditorByWorkspaceId: {
				...state.settingsEditorByWorkspaceId,
				[settingsEditor.workspaceId]: settingsEditor,
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
	const resourceInventory = await decodeResourceInventory(data);
	if (resourceInventory) {
		return {
			...state,
			resourceInventoryByWorkspaceId: {
				...state.resourceInventoryByWorkspaceId,
				[resourceInventory.workspaceId]: resourceInventory,
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

async function decodeImageAttachments(data: unknown): Promise<ImageAttachmentListSnapshot | undefined> {
	try {
		return await decodeImageAttachmentListSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeExport(data: unknown): Promise<SessionExportSnapshot | undefined> {
	try {
		const result = await decodeSessionExportResultSnapshot(data);
		return exportedArtifact(result);
	} catch {
		return undefined;
	}
}

function exportedArtifact(result: SessionExportResultSnapshot): SessionExportSnapshot | undefined {
	return result.status === "exported" ? result.artifact : undefined;
}

async function decodeShare(data: unknown): Promise<SessionShareSnapshot | undefined> {
	try {
		return await decodeSessionShareSnapshot(data);
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

async function decodeSettingsEditor(data: unknown): Promise<SettingsEditorSnapshot | undefined> {
	try {
		return await decodeSettingsEditorSnapshot(data);
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

async function decodeResourceInventory(data: unknown): Promise<ResourceInventorySnapshot | undefined> {
	try {
		return await decodeResourceInventorySnapshot(data);
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
