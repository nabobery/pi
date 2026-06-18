import { access, realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
	getDefaultSessionDir,
	SessionManager,
	type SessionInfo,
} from "../../../../coding-agent/src/core/session-manager.ts";
import {
	InvalidWorkspacePath,
	SessionCreateFailed,
	SessionFileMissing,
	SessionNotFound,
	SessionRenameFailed,
	SessionSyncFailed,
	WorkspaceNotFound,
	WorkspacePathMissing,
	catalogRevisionFromString,
	sessionIdFromString,
	type SessionCatalogSnapshot,
	type SessionId,
	type SessionSnapshot,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
	type WorkspaceSnapshot,
	workspaceIdFromString,
} from "../../contracts/index.ts";
import { type CatalogFileState, JsonCatalogStore } from "./json-catalog-store.ts";

export interface CatalogServiceOptions {
	sessionDir?: string;
	store?: JsonCatalogStore;
	now?: () => Date;
}

export class CatalogService {
	private readonly store: JsonCatalogStore;
	private readonly now: () => Date;
	private readonly sessionDir: string | undefined;

	constructor(options: CatalogServiceOptions = {}) {
		this.store = options.store ?? new JsonCatalogStore();
		this.now = options.now ?? (() => new Date());
		this.sessionDir = options.sessionDir;
	}

	async getWorkspaceCatalog(): Promise<WorkspaceCatalogSnapshot> {
		return toWorkspaceCatalog(await this.store.read());
	}

	getStartupWarning() {
		return this.store.getStartupWarning();
	}

	async getSessionCatalog(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot> {
		return toSessionCatalog(await this.store.read(), workspaceId);
	}

	async addWorkspace(path: string): Promise<WorkspaceCatalogSnapshot> {
		const workspacePath = await canonicalizeExistingWorkspacePath(path);
		const workspaceId = workspaceIdFromString(workspacePath);
		const timestamp = this.nowIso();
		const nextState = await this.store.update((state) => {
			const existing = state.workspaces.find((workspace) => workspace.id === workspaceId);
			const maxSortOrder = state.workspaces.reduce((max, workspace) => Math.max(max, workspace.sortOrder), -1);
			const nextWorkspace: WorkspaceSnapshot = {
				id: workspaceId,
				path: workspacePath,
				name: existing?.name ?? basename(workspacePath),
				lastOpenedAt: timestamp,
				sortOrder: existing?.sortOrder ?? maxSortOrder + 1,
				missing: false,
				selected: true,
			};
			return selectWorkspace(
				{
					...state,
					revision: nextRevision(state),
					workspaces: upsertBy(state.workspaces, nextWorkspace, (workspace) => workspace.id === workspaceId),
				},
				workspaceId,
			);
		});

		await this.syncWorkspace(workspaceId);
		return toWorkspaceCatalog(await this.store.read(), nextState.selectedWorkspaceId);
	}

	async selectWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceCatalogSnapshot> {
		const timestamp = this.nowIso();
		const nextState = await this.store.update((state) => {
			const workspace = findWorkspace(state, workspaceId);
			if (!workspace) {
				throw new WorkspaceNotFound({ workspaceId, message: `Workspace ${workspaceId} is not in the catalog` });
			}
			return selectWorkspace(
				{
					...state,
					revision: nextRevision(state),
					workspaces: state.workspaces.map((entry) =>
						entry.id === workspaceId ? { ...entry, lastOpenedAt: timestamp } : entry,
					),
				},
				workspaceId,
			);
		});
		return toWorkspaceCatalog(nextState);
	}

	async removeWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceCatalogSnapshot> {
		const nextState = await this.store.update((state) => {
			const nextSelectedWorkspaceId =
				state.selectedWorkspaceId === workspaceId ? undefined : state.selectedWorkspaceId;
			const selectedSessionByWorkspace = { ...state.selectedSessionByWorkspace };
			delete selectedSessionByWorkspace[workspaceId];
			const nextStateWithoutSelection = {
				...state,
				revision: nextRevision(state),
				selectedSessionByWorkspace,
				workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
				sessions: state.sessions.filter((session) => session.workspaceId !== workspaceId),
			};
			if (nextSelectedWorkspaceId)
				return { ...nextStateWithoutSelection, selectedWorkspaceId: nextSelectedWorkspaceId };
			const { selectedWorkspaceId: _selectedWorkspaceId, ...rest } = nextStateWithoutSelection;
			return rest;
		});
		return toWorkspaceCatalog(nextState);
	}

	async syncWorkspace(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot> {
		const state = await this.store.read();
		const workspace = findWorkspace(state, workspaceId);
		if (!workspace) {
			throw new WorkspaceNotFound({ workspaceId, message: `Workspace ${workspaceId} is not in the catalog` });
		}

		let canonicalPath: string;
		try {
			canonicalPath = await realpath(workspace.path);
		} catch {
			await this.markWorkspaceMissing(workspace);
			throw new WorkspacePathMissing({
				workspaceId,
				path: workspace.path,
				message: `Workspace path does not exist: ${workspace.path}`,
			});
		}

		let infos: SessionInfo[];
		try {
			const sessionDir = this.sessionDir ?? getDefaultSessionDir(canonicalPath);
			if (await pathExists(sessionDir)) {
				infos = await SessionManager.list(canonicalPath, sessionDir);
			} else {
				infos = [];
			}
		} catch (error) {
			const cause = getErrorMessage(error);
			throw new SessionSyncFailed({
				workspaceId,
				message: `Failed to sync sessions for workspace ${workspace.name}: ${cause}`,
				cause,
			});
		}

		const nextState = await this.store.update((current) => {
			const existingById = new Map(
				current.sessions
					.filter((session) => session.workspaceId === workspaceId)
					.map((session) => [session.id, session]),
			);
			const discovered = infos.map((info) =>
				sessionFromInfo(workspaceId, info, existingById.get(sessionIdFromString(info.id))),
			);
			const selectedSessionId = current.selectedSessionByWorkspace[workspaceId];
			const selectedSessionByWorkspace = { ...current.selectedSessionByWorkspace };
			if (selectedSessionId && !discovered.some((session) => session.id === selectedSessionId)) {
				delete selectedSessionByWorkspace[workspaceId];
			}
			return {
				...current,
				revision: nextRevision(current),
				selectedSessionByWorkspace,
				workspaces: current.workspaces.map((entry) =>
					entry.id === workspaceId ? { ...entry, path: canonicalPath, missing: false } : entry,
				),
				sessions: [...current.sessions.filter((session) => session.workspaceId !== workspaceId), ...discovered],
			};
		});

		return toSessionCatalog(nextState, workspaceId);
	}

	async createSession(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot> {
		const state = await this.store.read();
		const workspace = findWorkspace(state, workspaceId);
		if (!workspace) {
			throw new WorkspaceNotFound({ workspaceId, message: `Workspace ${workspaceId} is not in the catalog` });
		}
		if (workspace.missing) {
			throw new WorkspacePathMissing({
				workspaceId,
				path: workspace.path,
				message: `Workspace path does not exist: ${workspace.path}`,
			});
		}

		let canonicalPath: string;
		try {
			canonicalPath = await realpath(workspace.path);
		} catch {
			await this.markWorkspaceMissing(workspace);
			throw new WorkspacePathMissing({
				workspaceId,
				path: workspace.path,
				message: `Workspace path does not exist: ${workspace.path}`,
			});
		}

		let sessionFile: string | undefined;
		let sessionId: SessionId;
		try {
			const sessionManager = SessionManager.create(canonicalPath, this.sessionDir);
			sessionFile = sessionManager.ensureSessionFile();
			sessionId = sessionIdFromString(sessionManager.getSessionId());
		} catch (error) {
			throw new SessionCreateFailed({
				workspaceId,
				message: `Failed to create session for workspace ${workspace.name}`,
				cause: getErrorMessage(error),
			});
		}

		const timestamp = this.nowIso();
		const nextState = await this.store.update((current) => ({
			...current,
			revision: nextRevision(current),
			selectedSessionByWorkspace: { ...current.selectedSessionByWorkspace, [workspaceId]: sessionId },
			sessions: upsertBy(
				current.sessions,
				{
					id: sessionId,
					workspaceId,
					title: "New session",
					status: "idle",
					updatedAt: timestamp,
					preview: "",
					messageCount: 0,
					...(sessionFile ? { sessionFilePath: sessionFile } : {}),
				},
				(session) => session.workspaceId === workspaceId && session.id === sessionId,
			),
		}));
		return toSessionCatalog(nextState, workspaceId);
	}

	async openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		const state = await this.store.read();
		const session = findSession(state, workspaceId, sessionId);
		if (!session) throw new SessionNotFound({ sessionId, message: `Session ${sessionId} is not in the catalog` });
		await assertSessionFileExists(session);
		const nextState = await this.store.update((current) => ({
			...current,
			revision: nextRevision(current),
			selectedSessionByWorkspace: { ...current.selectedSessionByWorkspace, [session.workspaceId]: session.id },
		}));
		return toSessionCatalog(nextState, session.workspaceId);
	}

	async renameSession(workspaceId: WorkspaceId, sessionId: SessionId, title: string): Promise<SessionCatalogSnapshot> {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			throw new SessionRenameFailed({ sessionId, message: "Session title cannot be empty" });
		}

		const state = await this.store.read();
		const session = findSession(state, workspaceId, sessionId);
		if (!session) throw new SessionNotFound({ sessionId, message: `Session ${sessionId} is not in the catalog` });
		if (!session.sessionFilePath) {
			throw new SessionFileMissing({ sessionId, path: "", message: `Session ${sessionId} has no file path` });
		}
		await assertSessionFileExists(session);

		try {
			const manager = SessionManager.open(session.sessionFilePath);
			manager.ensureSessionFile();
			manager.appendSessionInfo(trimmedTitle);
		} catch (error) {
			throw new SessionRenameFailed({
				sessionId,
				message: `Failed to rename session ${sessionId}`,
				cause: getErrorMessage(error),
			});
		}

		const timestamp = this.nowIso();
		const nextState = await this.store.update((current) => ({
			...current,
			revision: nextRevision(current),
			sessions: current.sessions.map((entry) =>
				entry.workspaceId === workspaceId && entry.id === sessionId
					? { ...entry, title: trimmedTitle, updatedAt: timestamp }
					: entry,
			),
		}));
		return toSessionCatalog(nextState, session.workspaceId);
	}

	async archiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		return this.setArchivedAt(workspaceId, sessionId, this.nowIso());
	}

	async unarchiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		return this.setArchivedAt(workspaceId, sessionId, undefined);
	}

	private async setArchivedAt(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		archivedAt: string | undefined,
	): Promise<SessionCatalogSnapshot> {
		const state = await this.store.read();
		const session = findSession(state, workspaceId, sessionId);
		if (!session) throw new SessionNotFound({ sessionId, message: `Session ${sessionId} is not in the catalog` });
		const nextState = await this.store.update((current) => ({
			...current,
			revision: nextRevision(current),
			sessions: current.sessions
				.map((entry) =>
					entry.workspaceId === workspaceId && entry.id === sessionId
						? {
								...entry,
								...(archivedAt ? { archivedAt } : {}),
							}
						: entry,
				)
				.map((entry) => {
					if (entry.workspaceId !== workspaceId || entry.id !== sessionId || archivedAt) return entry;
					const { archivedAt: _removed, ...rest } = entry;
					return rest;
				}),
		}));
		return toSessionCatalog(nextState, session.workspaceId);
	}

	private async markWorkspaceMissing(workspace: WorkspaceSnapshot): Promise<void> {
		await this.store.update((state) => ({
			...state,
			revision: nextRevision(state),
			workspaces: state.workspaces.map((entry) => (entry.id === workspace.id ? { ...entry, missing: true } : entry)),
		}));
	}

	private nowIso(): string {
		return this.now().toISOString();
	}
}

function toWorkspaceCatalog(
	state: CatalogFileState,
	selectedWorkspaceId = state.selectedWorkspaceId,
): WorkspaceCatalogSnapshot {
	const workspaces = [];
	for (const workspace of [...state.workspaces].sort(sortWorkspaces)) {
		workspaces.push({ ...workspace, selected: workspace.id === selectedWorkspaceId });
	}
	return {
		revision: state.revision,
		...(selectedWorkspaceId ? { selectedWorkspaceId } : {}),
		workspaces,
	};
}

function toSessionCatalog(state: CatalogFileState, workspaceId: WorkspaceId): SessionCatalogSnapshot {
	return {
		workspaceId,
		selectedSessionId: state.selectedSessionByWorkspace[workspaceId],
		sessions: state.sessions.filter((session) => session.workspaceId === workspaceId).sort(sortSessions),
	};
}

function selectWorkspace(state: CatalogFileState, workspaceId: WorkspaceId): CatalogFileState {
	return {
		...state,
		selectedWorkspaceId: workspaceId,
		workspaces: state.workspaces.map((workspace) => ({
			...workspace,
			selected: workspace.id === workspaceId,
		})),
	};
}

async function canonicalizeExistingWorkspacePath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		throw new InvalidWorkspacePath({
			path,
			message: `Workspace path does not exist: ${path}`,
			cause: getErrorMessage(error),
		});
	}
}

function findWorkspace(state: CatalogFileState, workspaceId: WorkspaceId): WorkspaceSnapshot | undefined {
	return state.workspaces.find((workspace) => workspace.id === workspaceId);
}

function findSession(
	state: CatalogFileState,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
): SessionSnapshot | undefined {
	return state.sessions.find((session) => session.workspaceId === workspaceId && session.id === sessionId);
}

function sessionFromInfo(
	workspaceId: WorkspaceId,
	info: SessionInfo,
	existing: SessionSnapshot | undefined,
): SessionSnapshot {
	return {
		id: sessionIdFromString(info.id),
		workspaceId,
		title: info.name ?? info.firstMessage,
		status: "idle",
		updatedAt: info.modified.toISOString(),
		preview: info.firstMessage,
		messageCount: info.messageCount,
		sessionFilePath: info.path,
		...(existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
	};
}

async function assertSessionFileExists(session: SessionSnapshot): Promise<void> {
	if (!session.sessionFilePath) return;
	if (!(await pathExists(session.sessionFilePath))) {
		throw new SessionFileMissing({
			sessionId: session.id,
			path: session.sessionFilePath,
			message: `Session file does not exist: ${session.sessionFilePath}`,
		});
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function upsertBy<T>(items: readonly T[], item: T, predicate: (item: T) => boolean): T[] {
	const index = items.findIndex(predicate);
	if (index < 0) return [...items, item];
	return items.map((current, currentIndex) => (currentIndex === index ? item : current));
}

function nextRevision(state: CatalogFileState) {
	const current = Number.parseInt(state.revision, 10);
	return catalogRevisionFromString(Number.isFinite(current) ? String(current + 1) : "1");
}

function sortWorkspaces(left: WorkspaceSnapshot, right: WorkspaceSnapshot): number {
	const sortOrder = left.sortOrder - right.sortOrder;
	if (sortOrder !== 0) return sortOrder;
	return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
}

function sortSessions(left: SessionSnapshot, right: SessionSnapshot): number {
	if (left.archivedAt && !right.archivedAt) return 1;
	if (!left.archivedAt && right.archivedAt) return -1;
	return right.updatedAt.localeCompare(left.updatedAt);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
