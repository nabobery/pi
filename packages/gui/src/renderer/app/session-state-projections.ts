import type {
	QueueRestoreSnapshot,
	SessionActivitySnapshot,
	SessionCatalogSnapshot,
	SessionId,
	SessionSnapshot,
	WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogViewState } from "./app-store.ts";

export function applyQueueRestore(state: CatalogViewState, restored: QueueRestoreSnapshot): CatalogViewState {
	const key = sessionKey(restored.workspaceId, restored.sessionId);
	const restoredText = restored.restoredMessages.map((message) => message.text).join("\n");
	const previousDraft = state.composerDrafts[key] ?? "";
	const nextDraft = [previousDraft.trimEnd(), restoredText].filter(Boolean).join("\n");
	return {
		...state,
		queuesBySessionKey: {
			...state.queuesBySessionKey,
			[key]: restored.queue,
		},
		composerDrafts: {
			...state.composerDrafts,
			[key]: nextDraft,
		},
		activityBySessionKey: {
			...state.activityBySessionKey,
			[key]: {
				...(state.activityBySessionKey[key] ?? emptyActivity(restored.workspaceId, restored.sessionId)),
				queueCount: restored.queue.steeringCount + restored.queue.followUpCount,
			},
		},
	};
}

export function mergeSessionCatalog(state: CatalogViewState, catalog: SessionCatalogSnapshot): SessionCatalogSnapshot {
	return {
		...catalog,
		sessions: catalog.sessions.map((session) => applyRuntimeOverlay(state, session)),
	};
}

export function withRuntimeOverlay(state: CatalogViewState, session: SessionSnapshot): CatalogViewState {
	return {
		...state,
		runtimeOverlaysBySessionKey: {
			...state.runtimeOverlaysBySessionKey,
			[sessionKey(session.workspaceId, session.id)]: { status: session.status, isOpen: true },
		},
	};
}

export function setSessionStatus(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	status: SessionSnapshot["status"],
): CatalogViewState {
	const previous = state.sessionCatalogs[workspaceId];
	const overlaidState = {
		...state,
		runtimeOverlaysBySessionKey: {
			...state.runtimeOverlaysBySessionKey,
			[sessionKey(workspaceId, sessionId)]: { status, isOpen: true },
		},
	};
	if (!previous) return overlaidState;
	const sessions = previous.sessions.map((session) =>
		session.id === sessionId ? Object.assign({}, session, { status }) : session,
	);
	return {
		...overlaidState,
		sessionCatalogs: {
			...overlaidState.sessionCatalogs,
			[workspaceId]: {
				...previous,
				sessions,
			},
		},
	};
}

export function markSessionActivity(
	state: CatalogViewState,
	event: { workspaceId: WorkspaceId; sessionId: SessionId; sequence: number },
): CatalogViewState {
	const key = sessionKey(event.workspaceId, event.sessionId);
	const previous = state.activityBySessionKey[key] ?? emptyActivity(event.workspaceId, event.sessionId);
	const selectedKey = selectedSessionKey(state);
	return {
		...state,
		activityBySessionKey: {
			...state.activityBySessionKey,
			[key]: {
				...previous,
				hasUnread: selectedKey !== key,
				lastActivitySequence: event.sequence,
			},
		},
	};
}

export function applySessionActivityUpdate(
	state: CatalogViewState,
	activity: SessionActivitySnapshot,
): CatalogViewState {
	const key = sessionKey(activity.workspaceId, activity.sessionId);
	const previous = state.activityBySessionKey[key] ?? emptyActivity(activity.workspaceId, activity.sessionId);
	const selectedKey = selectedSessionKey(state);
	const hasPendingExtensionUi = (state.extensionUiBySessionKey[key]?.requests.length ?? 0) > 0;
	return {
		...state,
		activityBySessionKey: {
			...state.activityBySessionKey,
			[key]: {
				...previous,
				...activity,
				hasUnread: selectedKey === key ? false : activity.hasUnread || activity.lastActivitySequence > 0,
				needsInput: activity.needsInput || (previous.needsInput && hasPendingExtensionUi),
			},
		},
	};
}

export function markNeedsInput(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	needsInput: boolean,
	sequence: number,
): CatalogViewState {
	const key = sessionKey(workspaceId, sessionId);
	const previous = state.activityBySessionKey[key] ?? emptyActivity(workspaceId, sessionId);
	const selectedKey = selectedSessionKey(state);
	return {
		...state,
		activityBySessionKey: {
			...state.activityBySessionKey,
			[key]: {
				...previous,
				hasUnread: selectedKey === key ? false : needsInput || previous.hasUnread,
				needsInput,
				lastActivitySequence: sequence,
			},
		},
	};
}

export function clearUnread(state: CatalogViewState, workspaceId: WorkspaceId, sessionId: SessionId): CatalogViewState {
	const key = sessionKey(workspaceId, sessionId);
	const previous = state.activityBySessionKey[key];
	if (!previous) return state;
	return {
		...state,
		activityBySessionKey: {
			...state.activityBySessionKey,
			[key]: { ...previous, hasUnread: false },
		},
	};
}

export function sessionKey(workspaceId: WorkspaceId, sessionId: SessionId): string {
	return `${workspaceId}:${sessionId}`;
}

export function applyRuntimeOverlay(state: CatalogViewState, session: SessionSnapshot): SessionSnapshot {
	const overlay = state.runtimeOverlaysBySessionKey[sessionKey(session.workspaceId, session.id)];
	if (!overlay) return session;
	return { ...session, status: overlay.status };
}

function selectedSessionKey(state: CatalogViewState): string | undefined {
	const selectedWorkspaceId =
		state.workspaceCatalog.selectedWorkspaceId ??
		state.workspaceCatalog.workspaces.find((workspace) => workspace.selected)?.id;
	if (!selectedWorkspaceId) return undefined;
	const selectedSessionId = state.sessionCatalogs[selectedWorkspaceId]?.selectedSessionId;
	return selectedSessionId ? sessionKey(selectedWorkspaceId, selectedSessionId) : undefined;
}

function emptyActivity(workspaceId: WorkspaceId, sessionId: SessionId): SessionActivitySnapshot {
	return {
		workspaceId,
		sessionId,
		hasUnread: false,
		needsInput: false,
		queueCount: 0,
		lastActivitySequence: 0,
	};
}
