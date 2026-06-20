import { useSyncExternalStore } from "react";
import {
	ExtensionUiRespond,
	ExtensionUiUpdateEditorText,
	type CommonSettingsPatch,
	type ExtensionUiRequestSnapshot,
	type ExtensionUiStateSnapshot,
	SessionArchive,
	type SessionCatalogSnapshot,
	SessionCancelRun,
	SessionClose,
	SessionCreate,
	SessionGetTranscript,
	type SessionId,
	SessionOpen,
	SessionRename,
	SessionRestoreQueuedMessages,
	SessionSendMessage,
	SessionSetModel,
	SessionSetThinkingLevel,
	SessionUnarchive,
	type SessionSnapshot,
	type SessionTreeSnapshot,
	type ResourceInventorySnapshot,
	SettingsGetSummary,
	SettingsOpenGlobalFile,
	SettingsOpenProjectFile,
	SettingsRevealGlobalFile,
	SettingsRevealProjectFile,
	type SettingsEditorSnapshot,
	type SettingsSummarySnapshot,
	type ModelThinkingSnapshot,
	type QueueSnapshot,
	type SessionActivitySnapshot,
	type SlashCommandCatalogSnapshot,
	type ThinkingLevel,
	type TimelineSnapshot,
	TrustGetStatus,
	type TrustStatusSnapshot,
	type WorkspaceCatalogSnapshot,
	InternalIpcError,
	WorkspacePickDirectory,
	WorkspaceSelect,
	WorkspaceSync,
	decodeGuiCommandResult,
	decodeGuiEvent,
	type GuiCommand,
	type GuiCommandResult,
	type GuiEvent,
	type WorkspaceId,
	requestIdFromString,
} from "../../contracts/index.ts";
import {
	applyQueueRestore,
	applyRuntimeOverlay,
	applySessionActivityUpdate,
	clearUnread,
	markNeedsInput,
	markSessionActivity,
	mergeSessionCatalog,
	sessionKey as timelineKey,
	setSessionStatus,
	withRuntimeOverlay,
} from "./session-state-projections.ts";
import { applyCommandResultData, decodeQueueRestoreData } from "./app-result-appliers.ts";
import {
	createCommandPaletteStoreActions,
	emptyCommandPaletteState,
	emptyResumePickerState,
	type CommandPaletteState,
	type ResumePickerState,
} from "./command-palette-store.ts";
import {
	applyCompactionResult,
	applyNavigationResult,
	applyTreeEvent,
	createTreeAndCompactionStoreActions,
	emptyCompactDialogState,
	emptyTreeNavigatorState,
	type CompactDialogState,
	type TreeNavigatorState,
} from "./tree-and-compaction-store.ts";
import {
	applyControlPlaneEvent,
	createControlPlaneStoreActions,
	emptyControlPlaneState,
	type ControlPlaneState,
} from "./control-plane-store.ts";

export interface RendererCatalogApi {
	invoke(command: GuiCommand): Promise<GuiCommandResult>;
	subscribe(listener: (event: GuiEvent) => void): () => void;
}

export interface RendererCatalogTransport {
	invoke(command: GuiCommand): Promise<unknown>;
	subscribe(listener: (event: unknown) => void): () => void;
}

export interface CatalogViewState {
	workspaceCatalog: WorkspaceCatalogSnapshot;
	sessionCatalogs: Readonly<Record<string, SessionCatalogSnapshot>>;
	timelines: Readonly<Record<string, TimelineSnapshot>>;
	queuesBySessionKey: Readonly<Record<string, QueueSnapshot>>;
	composerDrafts: Readonly<Record<string, string>>;
	modelThinkingBySessionKey: Readonly<Record<string, ModelThinkingSnapshot>>;
	settingsSummaryByWorkspaceId: Readonly<Record<string, SettingsSummarySnapshot>>;
	settingsEditorByWorkspaceId: Readonly<Record<string, SettingsEditorSnapshot>>;
	trustStatusByWorkspaceId: Readonly<Record<string, TrustStatusSnapshot>>;
	resourceInventoryByWorkspaceId: Readonly<Record<string, ResourceInventorySnapshot>>;
	extensionUiBySessionKey: Readonly<Record<string, ExtensionUiSessionState>>;
	runtimeOverlaysBySessionKey: Readonly<Record<string, SessionRuntimeOverlay>>;
	activityBySessionKey: Readonly<Record<string, SessionActivitySnapshot>>;
	slashCommandCatalogsBySessionKey: Readonly<Record<string, SlashCommandCatalogSnapshot>>;
	treesBySessionKey: Readonly<Record<string, SessionTreeSnapshot>>;
	sessionRenameRequestsBySessionKey: Readonly<Record<string, number>>;
	commandPalette: CommandPaletteState;
	resumePicker: ResumePickerState;
	treeNavigator: TreeNavigatorState;
	compactDialog: CompactDialogState;
	controlPlane: ControlPlaneState;
	error: string | undefined;
	pending: boolean;
}

export interface SessionRuntimeOverlay {
	status: SessionSnapshot["status"];
	isOpen: boolean;
}

export interface ExtensionUiSessionState {
	requests: readonly ExtensionUiRequestSnapshot[];
	notifications: readonly ExtensionUiStateSnapshot[];
	statuses: Readonly<Record<string, string>>;
	title: string | undefined;
	compatibilityIssues: readonly string[];
}

export interface GuiCatalogStore {
	archiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	cancelCompaction(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	cancelRun(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	cancelTreeNavigation(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	closeSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	createSession(workspaceId: WorkspaceId): Promise<void>;
	closeCommandPalette(): void;
	closeCompactDialog(): void;
	closeControlPlane(): void;
	closeResumePicker(): void;
	closeTreeNavigator(): void;
	compactSession(workspaceId: WorkspaceId, sessionId: SessionId, customInstructions: string): Promise<void>;
	collapseTreeNavigatorEntry(entryId: string): void;
	expandTreeNavigatorEntry(entryId: string): void;
	getSlashCommands(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	getSnapshot(): CatalogViewState;
	getSettingsSummary(workspaceId: WorkspaceId): Promise<void>;
	getSettingsEditor(workspaceId: WorkspaceId): Promise<void>;
	getResourceInventory(workspaceId: WorkspaceId, sessionId: SessionId | undefined): Promise<void>;
	getTree(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	getTrustStatus(workspaceId: WorkspaceId): Promise<void>;
	getTranscript(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	openCommandPalette(query?: string): void;
	openCompactDialog(workspaceId: WorkspaceId, sessionId: SessionId): void;
	openControlPlane(
		tab: ControlPlaneState["tab"],
		workspaceId: WorkspaceId,
		sessionId: SessionId | undefined,
	): Promise<void>;
	openResumePicker(workspaceId: WorkspaceId): Promise<void>;
	openSettingsFile(workspaceId: WorkspaceId, scope: "global" | "project"): Promise<void>;
	pickWorkspaceDirectory(): Promise<void>;
	openTreeNavigator(workspaceId: WorkspaceId, sessionId: SessionId): void;
	navigateTree(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		targetEntryId: string;
		summaryMode: "none" | "default" | "custom";
		customInstructions?: string;
	}): Promise<void>;
	respondToExtensionUi(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		request: ExtensionUiRequestSnapshot,
		response:
			| { kind: "confirm"; confirmed: boolean }
			| { kind: "input"; value?: string; cancelled: boolean }
			| { kind: "select"; value?: string; cancelled: boolean }
			| { kind: "editor"; value?: string; cancelled: boolean }
			| { kind: "getEditorText"; value: string },
	): Promise<void>;
	revealSettingsFile(workspaceId: WorkspaceId, scope: "global" | "project"): Promise<void>;
	openResourceSource(workspaceId: WorkspaceId, resourceId: string): Promise<void>;
	reloadResources(workspaceId: WorkspaceId, sessionId: SessionId | undefined): Promise<void>;
	revealResourceSource(workspaceId: WorkspaceId, resourceId: string): Promise<void>;
	renameSession(workspaceId: WorkspaceId, sessionId: SessionId, title: string): Promise<void>;
	requestSessionRename(workspaceId: WorkspaceId, sessionId: SessionId): void;
	renameResumeSession(workspaceId: WorkspaceId, sessionId: SessionId, title: string): Promise<void>;
	resumeArchiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	resumeOpenSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	resumeUnarchiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	restoreQueuedMessages(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	searchResume(
		workspaceId: WorkspaceId,
		patch?: Partial<Pick<ResumePickerState, "includeArchived" | "nameFilter" | "query" | "scope" | "sortMode">>,
	): Promise<void>;
	selectWorkspace(workspaceId: WorkspaceId): Promise<void>;
	sendMessage(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		message: string,
		deliveryMode?: "steer" | "followUp",
	): Promise<boolean>;
	setComposerDraft(workspaceId: WorkspaceId, sessionId: SessionId, value: string): void;
	setCommandPaletteQuery(query: string): void;
	setCommandPaletteSelectedIndex(selectedIndex: number): void;
	setCompactInstructions(customInstructions: string): void;
	setModel(workspaceId: WorkspaceId, sessionId: SessionId, provider: string, modelId: string): Promise<void>;
	setResumePickerShowPaths(showPaths: boolean): void;
	setResumePickerSelectedIndex(selectedIndex: number): void;
	setThinkingLevel(workspaceId: WorkspaceId, sessionId: SessionId, thinkingLevel: ThinkingLevel): Promise<void>;
	saveTrustDecision(workspaceId: WorkspaceId, optionId: string): Promise<void>;
	updateCommonSettings(workspaceId: WorkspaceId, patch: CommonSettingsPatch): Promise<void>;
	setTreeEntryLabel(workspaceId: WorkspaceId, sessionId: SessionId, entryId: string, label: string): Promise<void>;
	setTreeNavigatorFilterMode(filterMode: TreeNavigatorState["filterMode"]): void;
	setTreeNavigatorQuery(query: string): void;
	setTreeNavigatorSelectedEntry(selectedEntryId: string | undefined): void;
	subscribe(listener: () => void): () => void;
	syncWorkspace(workspaceId: WorkspaceId): Promise<void>;
	unarchiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
}

export interface CreateGuiCatalogStoreOptions {
	initialError?: string;
}

let requestSequence = 0;

export function createGuiCatalogStore(
	api: RendererCatalogApi,
	workspaceCatalog: WorkspaceCatalogSnapshot,
	options: CreateGuiCatalogStoreOptions = {},
): GuiCatalogStore {
	let state: CatalogViewState = {
		workspaceCatalog,
		sessionCatalogs: {},
		timelines: {},
		queuesBySessionKey: {},
		composerDrafts: {},
		modelThinkingBySessionKey: {},
		settingsSummaryByWorkspaceId: {},
		settingsEditorByWorkspaceId: {},
		trustStatusByWorkspaceId: {},
		resourceInventoryByWorkspaceId: {},
		extensionUiBySessionKey: {},
		runtimeOverlaysBySessionKey: {},
		activityBySessionKey: {},
		slashCommandCatalogsBySessionKey: {},
		treesBySessionKey: {},
		sessionRenameRequestsBySessionKey: {},
		commandPalette: emptyCommandPaletteState(),
		resumePicker: emptyResumePickerState(),
		treeNavigator: emptyTreeNavigatorState(),
		compactDialog: emptyCompactDialogState(),
		controlPlane: emptyControlPlaneState(),
		error: options.initialError,
		pending: false,
	};
	const listeners = new Set<() => void>();

	api.subscribe((event) => {
		state = applyEvent(state, event);
		emit();
	});

	function emit(): void {
		for (const listener of listeners) listener();
	}

	function setState(nextState: CatalogViewState): void {
		state = nextState;
		emit();
	}

	function updateState(update: (current: CatalogViewState) => CatalogViewState): void {
		setState(update(state));
	}

	async function invoke(command: GuiCommand): Promise<boolean> {
		setState({ ...state, error: undefined, pending: true });
		const result = await api.invoke(command);
		if (!result.ok) {
			setState({ ...state, error: result.error.message, pending: false });
			return false;
		}
		setState({ ...(await applyCommandResultData(state, result.data)), pending: false });
		return true;
	}

	async function invokeVoid(command: GuiCommand): Promise<void> {
		await invoke(command);
	}

	const commandPaletteActions = createCommandPaletteStoreActions({
		api,
		getState: () => state,
		invoke,
		nextRequestId,
		updateState,
	});
	const treeAndCompactionActions = createTreeAndCompactionStoreActions({
		api,
		getState: () => state,
		invoke,
		nextRequestId,
		updateState,
	});
	const controlPlaneActions = createControlPlaneStoreActions({
		api,
		getState: () => state,
		nextRequestId,
		updateState,
	});

	return {
		archiveSession: (workspaceId, sessionId) =>
			invokeVoid(new SessionArchive({ requestId: nextRequestId("session.archive"), workspaceId, sessionId })),
		cancelRun: (workspaceId, sessionId) =>
			invokeVoid(new SessionCancelRun({ requestId: nextRequestId("session.cancelRun"), workspaceId, sessionId })),
		closeSession: (workspaceId, sessionId) =>
			invokeVoid(new SessionClose({ requestId: nextRequestId("session.close"), workspaceId, sessionId })),
		createSession: (workspaceId) =>
			invokeVoid(new SessionCreate({ requestId: nextRequestId("session.create"), workspaceId })),
		getSnapshot: () => state,
		getSettingsSummary: (workspaceId) =>
			invokeVoid(new SettingsGetSummary({ requestId: nextRequestId("settings.getSummary"), workspaceId })),
		getTrustStatus: (workspaceId) =>
			invokeVoid(new TrustGetStatus({ requestId: nextRequestId("trust.getStatus"), workspaceId })),
		getTranscript: (workspaceId, sessionId) =>
			invokeVoid(
				new SessionGetTranscript({ requestId: nextRequestId("session.getTranscript"), workspaceId, sessionId }),
			),
		openSession: (workspaceId, sessionId) =>
			invokeVoid(new SessionOpen({ requestId: nextRequestId("session.open"), workspaceId, sessionId })),
		openSettingsFile: (workspaceId, scope) =>
			invokeVoid(
				scope === "global"
					? new SettingsOpenGlobalFile({ requestId: nextRequestId("settings.openGlobalFile"), workspaceId })
					: new SettingsOpenProjectFile({ requestId: nextRequestId("settings.openProjectFile"), workspaceId }),
			),
		pickWorkspaceDirectory: () =>
			invokeVoid(new WorkspacePickDirectory({ requestId: nextRequestId("workspace.pickDirectory") })),
		respondToExtensionUi: (workspaceId, sessionId, request, response) =>
			invokeVoid(
				new ExtensionUiRespond({
					requestId: nextRequestId("extensionUi.respond"),
					workspaceId,
					sessionId,
					extensionUiRequestId: request.id,
					response,
				}),
			),
		revealSettingsFile: (workspaceId, scope) =>
			invokeVoid(
				scope === "global"
					? new SettingsRevealGlobalFile({ requestId: nextRequestId("settings.revealGlobalFile"), workspaceId })
					: new SettingsRevealProjectFile({ requestId: nextRequestId("settings.revealProjectFile"), workspaceId }),
			),
		renameSession: (workspaceId, sessionId, title) =>
			invokeVoid(new SessionRename({ requestId: nextRequestId("session.rename"), workspaceId, sessionId, title })),
		restoreQueuedMessages: async (workspaceId, sessionId) => {
			setState({ ...state, error: undefined, pending: true });
			const command = new SessionRestoreQueuedMessages({
				requestId: nextRequestId("session.restoreQueuedMessages"),
				workspaceId,
				sessionId,
			});
			const result = await api.invoke(command);
			if (!result.ok) {
				setState({ ...state, error: result.error.message, pending: false });
				return;
			}
			const restored = await decodeQueueRestoreData(result.data);
			setState({ ...(restored ? applyQueueRestore(state, restored) : state), pending: false });
		},
		selectWorkspace: (workspaceId) =>
			invokeVoid(new WorkspaceSelect({ requestId: nextRequestId("workspace.select"), workspaceId })),
		sendMessage: (workspaceId, sessionId, message, deliveryMode) =>
			invoke(
				new SessionSendMessage({
					requestId: nextRequestId("session.sendMessage"),
					workspaceId,
					sessionId,
					message,
					...(deliveryMode ? { deliveryMode } : {}),
				}),
			),
		setComposerDraft: (workspaceId, sessionId, value) => {
			setState({
				...state,
				composerDrafts: {
					...state.composerDrafts,
					[timelineKey(workspaceId, sessionId)]: value,
				},
			});
			void updateExtensionEditorText(workspaceId, sessionId, value);
		},
		setModel: (workspaceId, sessionId, provider, modelId) =>
			invokeVoid(
				new SessionSetModel({
					requestId: nextRequestId("session.setModel"),
					workspaceId,
					sessionId,
					provider,
					modelId,
				}),
			),
		setThinkingLevel: (workspaceId, sessionId, thinkingLevel) =>
			invokeVoid(
				new SessionSetThinkingLevel({
					requestId: nextRequestId("session.setThinkingLevel"),
					workspaceId,
					sessionId,
					thinkingLevel,
				}),
			),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		syncWorkspace: (workspaceId) =>
			invokeVoid(new WorkspaceSync({ requestId: nextRequestId("workspace.sync"), workspaceId })),
		unarchiveSession: (workspaceId, sessionId) =>
			invokeVoid(new SessionUnarchive({ requestId: nextRequestId("session.unarchive"), workspaceId, sessionId })),
		...controlPlaneActions,
		...commandPaletteActions,
		...treeAndCompactionActions,
	};

	async function updateExtensionEditorText(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		text: string,
	): Promise<void> {
		const result = await api.invoke(
			new ExtensionUiUpdateEditorText({
				requestId: nextRequestId("extensionUi.updateEditorText"),
				workspaceId,
				sessionId,
				text,
			}),
		);
		if (result.ok) return;
		setState({ ...state, error: result.error.message });
	}
}

export function createValidatedRendererCatalogApi(api: RendererCatalogTransport): RendererCatalogApi {
	return {
		invoke: async (command) => {
			try {
				return await decodeGuiCommandResult(await api.invoke(command));
			} catch (error) {
				return {
					ok: false,
					requestId: command.requestId,
					error: new InternalIpcError({
						message: "Invalid GUI command result",
						cause: getErrorMessage(error),
					}),
				};
			}
		},
		subscribe: (listener) =>
			api.subscribe((event) => {
				void decodeGuiEvent(event).then(listener, () => undefined);
			}),
	};
}

export function useCatalogStore(store: GuiCatalogStore): CatalogViewState {
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function applyEvent(state: CatalogViewState, event: GuiEvent): CatalogViewState {
	const controlPlaneState = applyControlPlaneEvent(state, event);
	if (controlPlaneState) return controlPlaneState;
	if (event._tag === "workspace.catalogUpdated") {
		return { ...state, workspaceCatalog: event.catalog };
	}
	if (event._tag === "workspace.synced") {
		return {
			...state,
			sessionCatalogs: { ...state.sessionCatalogs, [event.workspaceId]: mergeSessionCatalog(state, event.sessions) },
		};
	}
	if (event._tag === "session.catalogUpdated") {
		const previous = state.sessionCatalogs[event.workspaceId];
		const sessions = event.sessions.map((session) => applyRuntimeOverlay(state, session));
		return {
			...state,
			sessionCatalogs: {
				...state.sessionCatalogs,
				[event.workspaceId]: {
					workspaceId: event.workspaceId,
					selectedSessionId: previous?.selectedSessionId,
					sessions,
				},
			},
		};
	}
	if (event._tag === "session.selected") {
		const previous = state.sessionCatalogs[event.workspaceId];
		const selectedState = {
			...state,
			sessionCatalogs: {
				...state.sessionCatalogs,
				[event.workspaceId]: {
					workspaceId: event.workspaceId,
					selectedSessionId: event.sessionId,
					sessions: previous?.sessions ?? [],
				},
			},
		};
		return clearUnread(selectedState, event.workspaceId, event.sessionId);
	}
	if (event._tag === "session.opened" || event._tag === "session.statusChanged") {
		return upsertSession(withRuntimeOverlay(state, event.session), event.session);
	}
	if (event._tag === "session.closed") {
		const key = timelineKey(event.workspaceId, event.sessionId);
		const previous = state.sessionCatalogs[event.workspaceId];
		const { [key]: _closedTimeline, ...timelines } = state.timelines;
		const { [key]: _closedQueue, ...queuesBySessionKey } = state.queuesBySessionKey;
		const { [key]: _closedModelThinking, ...modelThinkingBySessionKey } = state.modelThinkingBySessionKey;
		const { [key]: _closedExtensionUi, ...extensionUiBySessionKey } = state.extensionUiBySessionKey;
		const { [key]: _closedOverlay, ...runtimeOverlaysBySessionKey } = state.runtimeOverlaysBySessionKey;
		const { [key]: _closedActivity, ...activityBySessionKey } = state.activityBySessionKey;
		const { [key]: _closedSlashCommandCatalog, ...slashCommandCatalogsBySessionKey } =
			state.slashCommandCatalogsBySessionKey;
		const { [key]: _closedTree, ...treesBySessionKey } = state.treesBySessionKey;
		if (!previous) {
			return {
				...state,
				timelines,
				queuesBySessionKey,
				modelThinkingBySessionKey,
				extensionUiBySessionKey,
				runtimeOverlaysBySessionKey,
				activityBySessionKey,
				slashCommandCatalogsBySessionKey,
				treesBySessionKey,
			};
		}
		const sessions: SessionSnapshot[] = [];
		for (const session of previous.sessions) {
			sessions.push(session.id === event.sessionId ? { ...session, status: "closed" } : session);
		}
		return {
			...state,
			timelines,
			queuesBySessionKey,
			modelThinkingBySessionKey,
			extensionUiBySessionKey,
			runtimeOverlaysBySessionKey,
			activityBySessionKey,
			slashCommandCatalogsBySessionKey,
			treesBySessionKey,
			sessionCatalogs: {
				...state.sessionCatalogs,
				[event.workspaceId]: {
					...previous,
					sessions,
				},
			},
		};
	}
	if (event._tag === "run.started") {
		return markSessionActivity(setSessionStatus(state, event.workspaceId, event.sessionId, "running"), event);
	}
	if (event._tag === "timeline.messageDelta") {
		return markSessionActivity(
			appendAssistantDelta(state, event.workspaceId, event.sessionId, event.runId, event.text),
			event,
		);
	}
	if (event._tag === "tool.started") {
		return markSessionActivity(
			upsertToolEntry(state, event.workspaceId, event.sessionId, {
				id: `tool:${event.toolCallId}`,
				kind: "tool",
				text: `${event.toolName} started`,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isLive: true,
			}),
			event,
		);
	}
	if (event._tag === "tool.updated") {
		return markSessionActivity(
			updateToolEntry(state, event.workspaceId, event.sessionId, event.toolCallId, {
				text: event.text,
				isLive: true,
			}),
			event,
		);
	}
	if (event._tag === "tool.finished") {
		return markSessionActivity(
			updateToolEntry(state, event.workspaceId, event.sessionId, event.toolCallId, {
				isLive: false,
				isError: event.isError,
			}),
			event,
		);
	}
	if (event._tag === "run.completed") {
		const readyState = setSessionStatus(state, event.workspaceId, event.sessionId, "ready");
		if (!event.timeline) return readyState;
		const markedState = markSessionActivity(readyState, event);
		return {
			...markedState,
			timelines: {
				...markedState.timelines,
				[timelineKey(event.workspaceId, event.sessionId)]: event.timeline,
			},
		};
	}
	if (event._tag === "run.failed") {
		const failedState = setSessionStatus(state, event.workspaceId, event.sessionId, "failed");
		return markSessionActivity(
			appendTimelineEntry({ ...failedState, error: event.error.message }, event.workspaceId, event.sessionId, {
				id: `error:${event.runId}`,
				kind: "error",
				text: event.error.message,
				isError: true,
			}),
			event,
		);
	}
	if (event._tag === "run.cancelled") {
		return markSessionActivity(setSessionStatus(state, event.workspaceId, event.sessionId, "ready"), event);
	}
	if (event._tag === "tree.updated") {
		return applyTreeEvent(state, event.tree);
	}
	if (event._tag === "tree.navigationCompleted") {
		return applyNavigationResult(state, event.result);
	}
	if (event._tag === "compaction.started") {
		return {
			...setSessionStatus(state, event.workspaceId, event.sessionId, "compacting"),
			compactDialog: { ...state.compactDialog, compacting: true, cancelling: false, error: undefined },
		};
	}
	if (event._tag === "compaction.completed") {
		return setSessionStatus(
			applyCompactionResult(state, event.result),
			event.result.workspaceId,
			event.result.sessionId,
			"ready",
		);
	}
	if (event._tag === "compaction.failed") {
		return {
			...setSessionStatus(state, event.workspaceId, event.sessionId, "ready"),
			compactDialog: { ...state.compactDialog, compacting: false, cancelling: false, error: event.error.message },
		};
	}
	if (event._tag === "compaction.cancelled") {
		return {
			...setSessionStatus(state, event.workspaceId, event.sessionId, "ready"),
			compactDialog: { ...state.compactDialog, compacting: false, cancelling: false },
		};
	}
	if (event._tag === "queue.updated") {
		return markSessionActivity(
			{
				...state,
				queuesBySessionKey: {
					...state.queuesBySessionKey,
					[timelineKey(event.workspaceId, event.sessionId)]: event.queue,
				},
			},
			event,
		);
	}
	if (event._tag === "session.activityUpdated") {
		return applySessionActivityUpdate(state, event.activity);
	}
	if (event._tag === "modelThinking.updated") {
		return {
			...state,
			modelThinkingBySessionKey: {
				...state.modelThinkingBySessionKey,
				[timelineKey(event.snapshot.workspaceId, event.snapshot.sessionId)]: event.snapshot,
			},
		};
	}
	if (event._tag === "settings.summaryUpdated") {
		return {
			...state,
			settingsSummaryByWorkspaceId: {
				...state.settingsSummaryByWorkspaceId,
				[event.summary.workspaceId]: event.summary,
			},
		};
	}
	if (event._tag === "trust.statusUpdated") {
		return {
			...state,
			trustStatusByWorkspaceId: {
				...state.trustStatusByWorkspaceId,
				[event.status.workspaceId]: event.status,
			},
		};
	}
	if (event._tag === "extensionUi.requested") {
		return markNeedsInput(
			upsertExtensionUiState(state, event.request.workspaceId, event.request.sessionId, (previous) => ({
				...previous,
				requests: [...previous.requests, event.request],
			})),
			event.request.workspaceId,
			event.request.sessionId,
			true,
			event.sequence,
		);
	}
	if (event._tag === "extensionUi.resolved") {
		const nextState = upsertExtensionUiState(state, event.workspaceId, event.sessionId, (previous) => ({
			...previous,
			requests: previous.requests.filter((request) => request.id !== event.extensionUiRequestId),
		}));
		const key = timelineKey(event.workspaceId, event.sessionId);
		return markNeedsInput(
			nextState,
			event.workspaceId,
			event.sessionId,
			(nextState.extensionUiBySessionKey[key]?.requests.length ?? 0) > 0,
			event.sequence,
		);
	}
	if (event._tag === "extensionUi.updated") {
		const update = event.update;
		if (update.kind === "editorText" && update.editorText !== undefined) {
			state = {
				...state,
				composerDrafts: {
					...state.composerDrafts,
					[timelineKey(update.workspaceId, update.sessionId)]: update.editorText,
				},
			};
		}
		return upsertExtensionUiState(state, update.workspaceId, update.sessionId, (previous) => {
			if (update.kind === "notify") {
				return { ...previous, notifications: [...previous.notifications, update].slice(-5) };
			}
			if (update.kind === "status" && update.statusKey) {
				const statuses = { ...previous.statuses };
				if (update.statusText === undefined) {
					delete statuses[update.statusKey];
				} else {
					statuses[update.statusKey] = update.statusText;
				}
				return { ...previous, statuses };
			}
			if (update.kind === "title") {
				return { ...previous, title: update.title };
			}
			return previous;
		});
	}
	if (event._tag === "extensionUi.compatibilityIssue") {
		return upsertExtensionUiState(state, event.workspaceId, event.sessionId, (previous) => ({
			...previous,
			compatibilityIssues: [...previous.compatibilityIssues, event.message].slice(-5),
		}));
	}
	return state;
}

function upsertSession(state: CatalogViewState, session: SessionCatalogSnapshot["sessions"][number]): CatalogViewState {
	session = applyRuntimeOverlay(state, session);
	const previous = state.sessionCatalogs[session.workspaceId];
	if (!previous) {
		return {
			...state,
			sessionCatalogs: {
				...state.sessionCatalogs,
				[session.workspaceId]: {
					workspaceId: session.workspaceId,
					selectedSessionId: session.id,
					sessions: [session],
				},
			},
		};
	}
	const exists = previous.sessions.some((entry) => entry.id === session.id);
	return {
		...state,
		sessionCatalogs: {
			...state.sessionCatalogs,
			[session.workspaceId]: {
				...previous,
				sessions: exists
					? previous.sessions.map((entry) => (entry.id === session.id ? session : entry))
					: [session, ...previous.sessions],
			},
		},
	};
}

function appendAssistantDelta(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	runId: string,
	text: string,
): CatalogViewState {
	const entryId = `live:${runId}:assistant`;
	const timeline = getTimeline(state, workspaceId, sessionId);
	const existing = timeline.entries.find((entry) => entry.id === entryId);
	const entries = existing
		? timeline.entries.map((entry) => (entry.id === entryId ? { ...entry, text: `${entry.text}${text}` } : entry))
		: [...timeline.entries, { id: entryId, kind: "assistant" as const, text, isLive: true }];
	return setTimeline(state, { ...timeline, entries });
}

function upsertToolEntry(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	entry: TimelineSnapshot["entries"][number],
): CatalogViewState {
	const timeline = getTimeline(state, workspaceId, sessionId);
	const exists = timeline.entries.some((candidate) => candidate.id === entry.id);
	const entries = exists
		? timeline.entries.map((candidate) => (candidate.id === entry.id ? { ...candidate, ...entry } : candidate))
		: [...timeline.entries, entry];
	return setTimeline(state, { ...timeline, entries });
}

function updateToolEntry(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	toolCallId: string,
	patch: Partial<TimelineSnapshot["entries"][number]>,
): CatalogViewState {
	const timeline = getTimeline(state, workspaceId, sessionId);
	const entryId = `tool:${toolCallId}`;
	const existing = timeline.entries.find((entry) => entry.id === entryId);
	const fallback: TimelineSnapshot["entries"][number] = {
		id: entryId,
		kind: "tool",
		text: "",
		toolCallId,
		...patch,
	};
	const entries = existing
		? timeline.entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry))
		: [...timeline.entries, fallback];
	return setTimeline(state, { ...timeline, entries });
}

function appendTimelineEntry(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	entry: TimelineSnapshot["entries"][number],
): CatalogViewState {
	const timeline = getTimeline(state, workspaceId, sessionId);
	return setTimeline(state, { ...timeline, entries: [...timeline.entries, entry] });
}

function getTimeline(state: CatalogViewState, workspaceId: WorkspaceId, sessionId: SessionId): TimelineSnapshot {
	return state.timelines[timelineKey(workspaceId, sessionId)] ?? { workspaceId, sessionId, entries: [] };
}

function setTimeline(state: CatalogViewState, timeline: TimelineSnapshot): CatalogViewState {
	return {
		...state,
		timelines: {
			...state.timelines,
			[timelineKey(timeline.workspaceId, timeline.sessionId)]: timeline,
		},
	};
}

function upsertExtensionUiState(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	update: (previous: ExtensionUiSessionState) => ExtensionUiSessionState,
): CatalogViewState {
	const key = timelineKey(workspaceId, sessionId);
	const previous = state.extensionUiBySessionKey[key] ?? emptyExtensionUiSessionState();
	return {
		...state,
		extensionUiBySessionKey: {
			...state.extensionUiBySessionKey,
			[key]: update(previous),
		},
	};
}

function emptyExtensionUiSessionState(): ExtensionUiSessionState {
	return {
		requests: [],
		notifications: [],
		statuses: {},
		title: undefined,
		compatibilityIssues: [],
	};
}

function nextRequestId(prefix: string) {
	requestSequence += 1;
	return requestIdFromString(`${prefix}.${requestSequence}`);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
