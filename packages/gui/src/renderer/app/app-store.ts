import { useSyncExternalStore } from "react";
import {
	SessionArchive,
	type SessionCatalogSnapshot,
	SessionCancelRun,
	SessionClose,
	SessionCreate,
	SessionGetTranscript,
	type SessionId,
	SessionOpen,
	SessionRename,
	SessionSendMessage,
	SessionUnarchive,
	type SessionSnapshot,
	type TimelineSnapshot,
	type WorkspaceCatalogSnapshot,
	InternalIpcError,
	WorkspacePickDirectory,
	WorkspaceSelect,
	WorkspaceSync,
	decodeGuiCommandResult,
	decodeGuiEvent,
	decodeSessionCatalogSnapshot,
	decodeTimelineSnapshot,
	decodeWorkspaceCatalogSnapshot,
	type GuiCommand,
	type GuiCommandResult,
	type GuiEvent,
	type WorkspaceId,
	requestIdFromString,
} from "../../contracts/index.ts";

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
	composerDrafts: Readonly<Record<string, string>>;
	error: string | undefined;
	pending: boolean;
}

export interface GuiCatalogStore {
	archiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	cancelRun(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	closeSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	createSession(workspaceId: WorkspaceId): Promise<void>;
	getSnapshot(): CatalogViewState;
	getTranscript(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	pickWorkspaceDirectory(): Promise<void>;
	renameSession(workspaceId: WorkspaceId, sessionId: SessionId, title: string): Promise<void>;
	selectWorkspace(workspaceId: WorkspaceId): Promise<void>;
	sendMessage(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		message: string,
		deliveryMode?: "steer" | "followUp",
	): Promise<boolean>;
	setComposerDraft(workspaceId: WorkspaceId, sessionId: SessionId, value: string): void;
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
		composerDrafts: {},
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

	async function invoke(command: GuiCommand): Promise<boolean> {
		setState({ ...state, error: undefined, pending: true });
		const result = await api.invoke(command);
		if (!result.ok) {
			setState({ ...state, error: result.error.message, pending: false });
			return false;
		}
		setState({ ...(await applyResult(state, result.data)), pending: false });
		return true;
	}

	async function invokeVoid(command: GuiCommand): Promise<void> {
		await invoke(command);
	}

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
		getTranscript: (workspaceId, sessionId) =>
			invokeVoid(
				new SessionGetTranscript({ requestId: nextRequestId("session.getTranscript"), workspaceId, sessionId }),
			),
		openSession: (workspaceId, sessionId) =>
			invokeVoid(new SessionOpen({ requestId: nextRequestId("session.open"), workspaceId, sessionId })),
		pickWorkspaceDirectory: () =>
			invokeVoid(new WorkspacePickDirectory({ requestId: nextRequestId("workspace.pickDirectory") })),
		renameSession: (workspaceId, sessionId, title) =>
			invokeVoid(new SessionRename({ requestId: nextRequestId("session.rename"), workspaceId, sessionId, title })),
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
		},
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
	};
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
	if (event._tag === "workspace.catalogUpdated") {
		return { ...state, workspaceCatalog: event.catalog };
	}
	if (event._tag === "workspace.synced") {
		return {
			...state,
			sessionCatalogs: { ...state.sessionCatalogs, [event.workspaceId]: event.sessions },
		};
	}
	if (event._tag === "session.catalogUpdated") {
		const previous = state.sessionCatalogs[event.workspaceId];
		return {
			...state,
			sessionCatalogs: {
				...state.sessionCatalogs,
				[event.workspaceId]: {
					workspaceId: event.workspaceId,
					selectedSessionId: previous?.selectedSessionId,
					sessions: event.sessions,
				},
			},
		};
	}
	if (event._tag === "session.selected") {
		const previous = state.sessionCatalogs[event.workspaceId];
		return {
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
	}
	if (event._tag === "session.opened" || event._tag === "session.statusChanged") {
		return upsertSession(state, event.session);
	}
	if (event._tag === "session.closed") {
		const key = timelineKey(event.workspaceId, event.sessionId);
		const previous = state.sessionCatalogs[event.workspaceId];
		const { [key]: _closedTimeline, ...timelines } = state.timelines;
		if (!previous) return { ...state, timelines };
		const sessions: SessionSnapshot[] = [];
		for (const session of previous.sessions) {
			sessions.push(session.id === event.sessionId ? { ...session, status: "closed" } : session);
		}
		return {
			...state,
			timelines,
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
		return setSessionStatus(state, event.workspaceId, event.sessionId, "running");
	}
	if (event._tag === "timeline.messageDelta") {
		return appendAssistantDelta(state, event.workspaceId, event.sessionId, event.runId, event.text);
	}
	if (event._tag === "tool.started") {
		return upsertToolEntry(state, event.workspaceId, event.sessionId, {
			id: `tool:${event.toolCallId}`,
			kind: "tool",
			text: `${event.toolName} started`,
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			isLive: true,
		});
	}
	if (event._tag === "tool.updated") {
		return updateToolEntry(state, event.workspaceId, event.sessionId, event.toolCallId, {
			text: event.text,
			isLive: true,
		});
	}
	if (event._tag === "tool.finished") {
		return updateToolEntry(state, event.workspaceId, event.sessionId, event.toolCallId, {
			isLive: false,
			isError: event.isError,
		});
	}
	if (event._tag === "run.completed") {
		const readyState = setSessionStatus(state, event.workspaceId, event.sessionId, "ready");
		if (!event.timeline) return readyState;
		return {
			...readyState,
			timelines: {
				...readyState.timelines,
				[timelineKey(event.workspaceId, event.sessionId)]: event.timeline,
			},
		};
	}
	if (event._tag === "run.failed") {
		const failedState = setSessionStatus(state, event.workspaceId, event.sessionId, "failed");
		return appendTimelineEntry({ ...failedState, error: event.error.message }, event.workspaceId, event.sessionId, {
			id: `error:${event.runId}`,
			kind: "error",
			text: event.error.message,
			isError: true,
		});
	}
	if (event._tag === "run.cancelled") {
		return setSessionStatus(state, event.workspaceId, event.sessionId, "ready");
	}
	return state;
}

async function applyResult(state: CatalogViewState, data: unknown): Promise<CatalogViewState> {
	const workspaceCatalog = await decodeWorkspaceCatalog(data);
	if (workspaceCatalog) return { ...state, workspaceCatalog };
	const sessionCatalog = await decodeSessionCatalog(data);
	if (sessionCatalog) {
		return {
			...state,
			sessionCatalogs: { ...state.sessionCatalogs, [sessionCatalog.workspaceId]: sessionCatalog },
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
	return state;
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

function upsertSession(state: CatalogViewState, session: SessionCatalogSnapshot["sessions"][number]): CatalogViewState {
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

function setSessionStatus(
	state: CatalogViewState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	status: SessionSnapshot["status"],
): CatalogViewState {
	const previous = state.sessionCatalogs[workspaceId];
	if (!previous) return state;
	const sessions: SessionSnapshot[] = [];
	for (const session of previous.sessions) {
		sessions.push(session.id === sessionId ? Object.assign({}, session, { status }) : session);
	}
	return {
		...state,
		sessionCatalogs: {
			...state.sessionCatalogs,
			[workspaceId]: {
				...previous,
				sessions,
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

function timelineKey(workspaceId: WorkspaceId, sessionId: SessionId): string {
	return `${workspaceId}:${sessionId}`;
}

function nextRequestId(prefix: string) {
	requestSequence += 1;
	return requestIdFromString(`${prefix}.${requestSequence}`);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
