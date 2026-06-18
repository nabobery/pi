import {
	SessionAlreadyOpen,
	SessionClosed,
	SessionFileMissing,
	SessionOpened,
	SessionRuntimeNotFound,
	SessionStatusChanged,
	type GuiEvent,
	type SessionCatalogSnapshot,
	type SessionId,
	type SessionSnapshot,
	type TimelineSnapshot,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { createRuntimeSessionKey, type RuntimeSessionKey } from "./session-key.ts";
import type { RuntimeSessionHandle, SessionDriver } from "./session-driver.ts";

export interface SessionCatalogRuntimeService {
	createSession(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot>;
	getWorkspaceCatalog(): Promise<WorkspaceCatalogSnapshot>;
	openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot>;
}

export interface SessionSupervisorEventBus {
	nextEventBase(): ConstructorParameters<typeof SessionOpened>[0] extends infer Payload
		? Payload extends { eventId: infer EventId; sequence: number }
			? { eventId: EventId; sequence: number }
			: never
		: never;
	publish(event: GuiEvent): void;
}

export interface SessionSupervisorOptions {
	catalogService: SessionCatalogRuntimeService;
	driver: SessionDriver;
	eventBus: SessionSupervisorEventBus;
}

interface ManagedSessionRecord {
	handle: RuntimeSessionHandle;
	session: SessionSnapshot;
	unsubscribe: () => void;
}

export class SessionSupervisor {
	private readonly catalogService: SessionCatalogRuntimeService;
	private readonly driver: SessionDriver;
	private readonly eventBus: SessionSupervisorEventBus;
	private readonly records = new Map<RuntimeSessionKey, ManagedSessionRecord>();

	constructor(options: SessionSupervisorOptions) {
		this.catalogService = options.catalogService;
		this.driver = options.driver;
		this.eventBus = options.eventBus;
	}

	hasRuntime(workspaceId: WorkspaceId, sessionId: SessionId): boolean {
		return this.records.has(createRuntimeSessionKey(workspaceId, sessionId));
	}

	async createSession(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot> {
		const catalog = await this.catalogService.createSession(workspaceId);
		const session = findSelectedSession(catalog);
		await this.openRuntimeForSession(session);
		return catalog;
	}

	async openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		const catalog = await this.catalogService.openSession(workspaceId, sessionId);
		const session = findSession(catalog, sessionId);
		await this.openRuntimeForSession(session);
		return catalog;
	}

	async closeSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const record = this.records.get(key);
		if (!record) {
			throw new SessionRuntimeNotFound({
				workspaceId,
				sessionId,
				message: `Session runtime ${key} is not open`,
			});
		}

		await this.driver.closeSession(record.handle);
		record.unsubscribe();
		this.records.delete(key);
		this.eventBus.publish(new SessionClosed({ ...this.eventBus.nextEventBase(), workspaceId, sessionId }));
	}

	async getTranscript(workspaceId: WorkspaceId, sessionId: SessionId): Promise<TimelineSnapshot> {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const record = this.records.get(key);
		if (!record) {
			throw new SessionRuntimeNotFound({
				workspaceId,
				sessionId,
				message: `Session runtime ${key} is not open`,
			});
		}
		return this.driver.getTranscript(record.handle);
	}

	private async openRuntimeForSession(session: SessionSnapshot): Promise<void> {
		const key = createRuntimeSessionKey(session.workspaceId, session.id);
		if (this.records.has(key)) {
			throw new SessionAlreadyOpen({
				workspaceId: session.workspaceId,
				sessionId: session.id,
				message: `Session runtime ${key} is already open`,
			});
		}
		if (!session.sessionFilePath) {
			throw new SessionFileMissing({
				sessionId: session.id,
				path: "",
				message: `Session ${session.id} has no file path`,
			});
		}

		this.publishStatus(session, "opening");
		try {
			const workspacePath = await this.getWorkspacePath(session.workspaceId);
			const handle = await this.driver.openSession({
				sessionFilePath: session.sessionFilePath,
				workspaceId: session.workspaceId,
				workspacePath,
			});
			const readySession = withStatus(session, "ready");
			const unsubscribe = this.driver.subscribe(handle, () => undefined);
			this.records.set(key, { handle, session: readySession, unsubscribe });
			this.eventBus.publish(new SessionOpened({ ...this.eventBus.nextEventBase(), session: readySession }));
			this.publishStatus(session, "ready");
		} catch (error) {
			this.publishStatus(session, "failed");
			throw error;
		}
	}

	private async getWorkspacePath(workspaceId: WorkspaceId): Promise<string> {
		const catalog = await this.catalogService.getWorkspaceCatalog();
		const workspace = catalog.workspaces.find((entry) => entry.id === workspaceId);
		if (!workspace) return workspaceId;
		return workspace.path;
	}

	private publishStatus(session: SessionSnapshot, status: SessionSnapshot["status"]): void {
		this.eventBus.publish(
			new SessionStatusChanged({
				...this.eventBus.nextEventBase(),
				session: withStatus(session, status),
			}),
		);
	}
}

function findSelectedSession(catalog: SessionCatalogSnapshot): SessionSnapshot {
	const selectedSessionId = catalog.selectedSessionId ?? catalog.sessions[0]?.id;
	if (selectedSessionId) return findSession(catalog, selectedSessionId);
	throw new SessionFileMissing({ sessionId: "", path: "", message: "Created session was not returned by catalog" });
}

function findSession(catalog: SessionCatalogSnapshot, sessionId: SessionId): SessionSnapshot {
	const session = catalog.sessions.find((entry) => entry.id === sessionId);
	if (session) return session;
	throw new SessionRuntimeNotFound({
		workspaceId: catalog.workspaceId,
		sessionId,
		message: `Session ${sessionId} was not returned by catalog`,
	});
}

function withStatus(session: SessionSnapshot, status: SessionSnapshot["status"]): SessionSnapshot {
	return { ...session, status };
}
