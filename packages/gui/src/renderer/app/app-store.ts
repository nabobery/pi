import { useSyncExternalStore } from "react";
import {
	SessionArchive,
	type SessionCatalogSnapshot,
	SessionClose,
	SessionCreate,
	SessionGetTranscript,
	type SessionId,
	SessionOpen,
	SessionRename,
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
	error: string | undefined;
	pending: boolean;
}

export interface GuiCatalogStore {
	archiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	closeSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	createSession(workspaceId: WorkspaceId): Promise<void>;
	getSnapshot(): CatalogViewState;
	getTranscript(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	pickWorkspaceDirectory(): Promise<void>;
	renameSession(workspaceId: WorkspaceId, sessionId: SessionId, title: string): Promise<void>;
	selectWorkspace(workspaceId: WorkspaceId): Promise<void>;
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

	async function invoke(command: GuiCommand): Promise<void> {
		setState({ ...state, error: undefined, pending: true });
		const result = await api.invoke(command);
		if (!result.ok) {
			setState({ ...state, error: result.error.message, pending: false });
			return;
		}
		setState({ ...(await applyResult(state, result.data)), pending: false });
	}

	return {
		archiveSession: (workspaceId, sessionId) =>
			invoke(new SessionArchive({ requestId: nextRequestId("session.archive"), workspaceId, sessionId })),
		closeSession: (workspaceId, sessionId) =>
			invoke(new SessionClose({ requestId: nextRequestId("session.close"), workspaceId, sessionId })),
		createSession: (workspaceId) =>
			invoke(new SessionCreate({ requestId: nextRequestId("session.create"), workspaceId })),
		getSnapshot: () => state,
		getTranscript: (workspaceId, sessionId) =>
			invoke(
				new SessionGetTranscript({ requestId: nextRequestId("session.getTranscript"), workspaceId, sessionId }),
			),
		openSession: (workspaceId, sessionId) =>
			invoke(new SessionOpen({ requestId: nextRequestId("session.open"), workspaceId, sessionId })),
		pickWorkspaceDirectory: () =>
			invoke(new WorkspacePickDirectory({ requestId: nextRequestId("workspace.pickDirectory") })),
		renameSession: (workspaceId, sessionId, title) =>
			invoke(new SessionRename({ requestId: nextRequestId("session.rename"), workspaceId, sessionId, title })),
		selectWorkspace: (workspaceId) =>
			invoke(new WorkspaceSelect({ requestId: nextRequestId("workspace.select"), workspaceId })),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		syncWorkspace: (workspaceId) =>
			invoke(new WorkspaceSync({ requestId: nextRequestId("workspace.sync"), workspaceId })),
		unarchiveSession: (workspaceId, sessionId) =>
			invoke(new SessionUnarchive({ requestId: nextRequestId("session.unarchive"), workspaceId, sessionId })),
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
