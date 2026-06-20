import {
	SessionCancelCompaction,
	SessionCancelTreeNavigation,
	SessionCompact,
	SessionGetTree,
	SessionNavigateTree,
	SessionSetTreeEntryLabel,
	TreeFilterMode,
	decodeSessionCompactionSnapshot,
	decodeSessionTreeSnapshot,
	decodeTreeNavigationSnapshot,
	type GuiCommand,
	type RequestId,
	type SessionCompactionSnapshot,
	type SessionId,
	type SessionTreeSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { sessionKey } from "./session-state-projections.ts";
import type { CatalogViewState, GuiCatalogStore, RendererCatalogApi } from "./app-store.ts";

export interface TreeNavigatorState {
	open: boolean;
	workspaceId: WorkspaceId | undefined;
	sessionId: SessionId | undefined;
	query: string;
	filterMode: TreeFilterMode;
	selectedEntryId: string | undefined;
	foldedEntryIds: readonly string[];
	loading: boolean;
	navigationCancelling: boolean;
	navigationPending: boolean;
	error: string | undefined;
}

export interface CompactDialogState {
	open: boolean;
	workspaceId: WorkspaceId | undefined;
	sessionId: SessionId | undefined;
	customInstructions: string;
	compacting: boolean;
	error: string | undefined;
	lastResult: SessionCompactionSnapshot | undefined;
	cancelling: boolean;
}

export type TreeAndCompactionStoreActions = Pick<
	GuiCatalogStore,
	| "cancelCompaction"
	| "cancelTreeNavigation"
	| "closeCompactDialog"
	| "closeTreeNavigator"
	| "compactSession"
	| "collapseTreeNavigatorEntry"
	| "expandTreeNavigatorEntry"
	| "getTree"
	| "navigateTree"
	| "openCompactDialog"
	| "openTreeNavigator"
	| "setCompactInstructions"
	| "setTreeEntryLabel"
	| "setTreeNavigatorFilterMode"
	| "setTreeNavigatorQuery"
	| "setTreeNavigatorSelectedEntry"
>;

export interface TreeAndCompactionStoreContext {
	api: RendererCatalogApi;
	getState(): CatalogViewState;
	invoke(command: GuiCommand): Promise<boolean>;
	nextRequestId(prefix: string): RequestId;
	updateState(update: (current: CatalogViewState) => CatalogViewState): void;
}

export function createTreeAndCompactionStoreActions(
	context: TreeAndCompactionStoreContext,
): TreeAndCompactionStoreActions {
	return {
		cancelCompaction: async (workspaceId, sessionId) => {
			context.updateState((current) => ({
				...current,
				compactDialog: { ...current.compactDialog, cancelling: true, error: undefined },
			}));
			const result = await context.api.invoke(
				new SessionCancelCompaction({
					requestId: context.nextRequestId("session.cancelCompaction"),
					workspaceId,
					sessionId,
				}),
			);
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					compactDialog: { ...current.compactDialog, cancelling: false, error: result.error.message },
				}));
				return;
			}
			context.updateState((current) => ({
				...current,
				compactDialog: { ...current.compactDialog, compacting: false, cancelling: false, error: undefined },
			}));
		},
		cancelTreeNavigation: async (workspaceId, sessionId) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: { ...current.treeNavigator, navigationCancelling: true, error: undefined },
			}));
			const result = await context.api.invoke(
				new SessionCancelTreeNavigation({
					requestId: context.nextRequestId("session.cancelTreeNavigation"),
					workspaceId,
					sessionId,
				}),
			);
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					treeNavigator: {
						...current.treeNavigator,
						navigationCancelling: false,
						error: result.error.message,
					},
				}));
				return;
			}
			context.updateState((current) => ({
				...current,
				treeNavigator: { ...current.treeNavigator, navigationPending: false, navigationCancelling: false },
			}));
		},
		closeCompactDialog: () => {
			context.updateState((current) => ({
				...current,
				compactDialog: { ...current.compactDialog, open: false, error: undefined },
			}));
		},
		closeTreeNavigator: () => {
			context.updateState((current) => ({
				...current,
				treeNavigator: current.treeNavigator.navigationPending
					? current.treeNavigator
					: { ...current.treeNavigator, open: false, error: undefined },
			}));
		},
		compactSession: async (workspaceId, sessionId, customInstructions) => {
			context.updateState((current) => ({
				...current,
				compactDialog: { ...current.compactDialog, compacting: true, cancelling: false, error: undefined },
			}));
			const result = await context.api.invoke(
				new SessionCompact({
					requestId: context.nextRequestId("session.compact"),
					workspaceId,
					sessionId,
					...(customInstructions.trim() ? { customInstructions: customInstructions.trim() } : {}),
				}),
			);
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					compactDialog: {
						...current.compactDialog,
						compacting: false,
						cancelling: false,
						error: result.error.message,
					},
				}));
				return;
			}
			const snapshot = await decodeCompaction(result.data);
			context.updateState((current) => applyCompactionResult(current, snapshot));
		},
		collapseTreeNavigatorEntry: (entryId) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: {
					...current.treeNavigator,
					foldedEntryIds: current.treeNavigator.foldedEntryIds.includes(entryId)
						? current.treeNavigator.foldedEntryIds
						: [...current.treeNavigator.foldedEntryIds, entryId],
				},
			}));
		},
		expandTreeNavigatorEntry: (entryId) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: {
					...current.treeNavigator,
					foldedEntryIds: current.treeNavigator.foldedEntryIds.filter((id) => id !== entryId),
				},
			}));
		},
		getTree: async (workspaceId, sessionId) => {
			const key = sessionKey(workspaceId, sessionId);
			context.updateState((current) => ({
				...current,
				treeNavigator: { ...current.treeNavigator, loading: true, error: undefined },
			}));
			const result = await context.api.invoke(
				new SessionGetTree({ requestId: context.nextRequestId("session.getTree"), workspaceId, sessionId }),
			);
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					treeNavigator: { ...current.treeNavigator, loading: false, error: result.error.message },
				}));
				return;
			}
			const tree = await decodeTree(result.data);
			context.updateState((current) => ({
				...current,
				treesBySessionKey: tree ? { ...current.treesBySessionKey, [key]: tree } : current.treesBySessionKey,
				treeNavigator: {
					...current.treeNavigator,
					loading: false,
					error: undefined,
					selectedEntryId: tree?.leafEntryId ?? tree?.entries[0]?.entryId,
				},
			}));
		},
		navigateTree: async (request) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: {
					...current.treeNavigator,
					navigationPending: true,
					navigationCancelling: false,
					error: undefined,
				},
			}));
			const result = await context.api.invoke(
				new SessionNavigateTree({
					requestId: context.nextRequestId("session.navigateTree"),
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					targetEntryId: request.targetEntryId,
					summaryMode: request.summaryMode,
					...(request.customInstructions?.trim() ? { customInstructions: request.customInstructions.trim() } : {}),
				}),
			);
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					treeNavigator: {
						...current.treeNavigator,
						navigationPending: false,
						navigationCancelling: false,
						error: result.error.message,
					},
				}));
				return;
			}
			const snapshot = await decodeNavigation(result.data);
			context.updateState((current) => applyNavigationResult(current, snapshot));
		},
		openCompactDialog: (workspaceId, sessionId) => {
			context.updateState((current) => ({
				...current,
				compactDialog: {
					...emptyCompactDialogState(),
					open: true,
					workspaceId,
					sessionId,
				},
			}));
		},
		openTreeNavigator: (workspaceId, sessionId) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: {
					...current.treeNavigator,
					open: true,
					workspaceId,
					sessionId,
					loading: true,
					error: undefined,
				},
			}));
			void context.api
				.invoke(new SessionGetTree({ requestId: context.nextRequestId("session.getTree"), workspaceId, sessionId }))
				.then(async (result) => {
					if (!result.ok) {
						context.updateState((current) => ({
							...current,
							treeNavigator: { ...current.treeNavigator, loading: false, error: result.error.message },
						}));
						return;
					}
					const tree = await decodeTree(result.data);
					const key = sessionKey(workspaceId, sessionId);
					context.updateState((current) => ({
						...current,
						treesBySessionKey: tree ? { ...current.treesBySessionKey, [key]: tree } : current.treesBySessionKey,
						treeNavigator: {
							...current.treeNavigator,
							loading: false,
							selectedEntryId: tree?.leafEntryId ?? tree?.entries[0]?.entryId,
						},
					}));
				})
				.catch((error: unknown) => {
					context.updateState((current) => ({
						...current,
						treeNavigator: { ...current.treeNavigator, loading: false, error: getErrorMessage(error) },
					}));
				});
		},
		setCompactInstructions: (customInstructions) => {
			context.updateState((current) => ({
				...current,
				compactDialog: { ...current.compactDialog, customInstructions },
			}));
		},
		setTreeEntryLabel: async (workspaceId, sessionId, entryId, label) => {
			const result = await context.api.invoke(
				new SessionSetTreeEntryLabel({
					requestId: context.nextRequestId("session.setTreeEntryLabel"),
					workspaceId,
					sessionId,
					entryId,
					...(label.trim() ? { label: label.trim() } : {}),
				}),
			);
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					treeNavigator: { ...current.treeNavigator, error: result.error.message },
				}));
				return;
			}
			const tree = await decodeTree(result.data);
			context.updateState((current) => updateTreeState(current, tree));
		},
		setTreeNavigatorFilterMode: (filterMode) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: { ...current.treeNavigator, filterMode, selectedEntryId: undefined },
			}));
		},
		setTreeNavigatorQuery: (query) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: { ...current.treeNavigator, query, selectedEntryId: undefined },
			}));
		},
		setTreeNavigatorSelectedEntry: (selectedEntryId) => {
			context.updateState((current) => ({
				...current,
				treeNavigator: { ...current.treeNavigator, selectedEntryId },
			}));
		},
	};
}

export function emptyTreeNavigatorState(): TreeNavigatorState {
	return {
		open: false,
		workspaceId: undefined,
		sessionId: undefined,
		query: "",
		filterMode: "default",
		selectedEntryId: undefined,
		foldedEntryIds: [],
		loading: false,
		navigationCancelling: false,
		navigationPending: false,
		error: undefined,
	};
}

export function emptyCompactDialogState(): CompactDialogState {
	return {
		open: false,
		workspaceId: undefined,
		sessionId: undefined,
		customInstructions: "",
		compacting: false,
		error: undefined,
		lastResult: undefined,
		cancelling: false,
	};
}

export function applyTreeEvent(state: CatalogViewState, tree: SessionTreeSnapshot): CatalogViewState {
	return updateTreeState(state, tree);
}

export function applyCompactionResult(
	state: CatalogViewState,
	snapshot: SessionCompactionSnapshot | undefined,
): CatalogViewState {
	if (!snapshot) {
		return { ...state, compactDialog: { ...state.compactDialog, compacting: false, cancelling: false } };
	}
	const key = sessionKey(snapshot.workspaceId, snapshot.sessionId);
	return {
		...updateTreeState(state, snapshot.tree),
		timelines: { ...state.timelines, [key]: snapshot.timeline },
		compactDialog: {
			...state.compactDialog,
			compacting: false,
			cancelling: false,
			error: undefined,
			lastResult: snapshot,
			open: false,
		},
	};
}

export function applyNavigationResult(
	state: CatalogViewState,
	snapshot: Awaited<ReturnType<typeof decodeNavigation>> | undefined,
): CatalogViewState {
	if (!snapshot) return state;
	const key = sessionKey(snapshot.workspaceId, snapshot.sessionId);
	const draft = snapshot.editorText ?? "";
	return {
		...updateTreeState(state, snapshot.tree),
		timelines: { ...state.timelines, [key]: snapshot.timeline },
		composerDrafts: { ...state.composerDrafts, [key]: snapshot.clearsComposer ? "" : draft },
		treeNavigator: {
			...state.treeNavigator,
			open: snapshot.cancelled ? state.treeNavigator.open : false,
			navigationPending: false,
			navigationCancelling: false,
			error: undefined,
		},
	};
}

function updateTreeState(state: CatalogViewState, tree: SessionTreeSnapshot | undefined): CatalogViewState {
	if (!tree) return state;
	return {
		...state,
		treesBySessionKey: {
			...state.treesBySessionKey,
			[sessionKey(tree.workspaceId, tree.sessionId)]: tree,
		},
	};
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

async function decodeCompaction(data: unknown): Promise<SessionCompactionSnapshot | undefined> {
	try {
		return await decodeSessionCompactionSnapshot(data);
	} catch {
		return undefined;
	}
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
