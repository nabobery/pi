import { access, realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
	filterAndSortSessions,
	getDefaultSessionDir,
	SessionManager,
	type NameFilter,
	type SessionInfo,
	type SortMode,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	ResumeArchiveFailed,
	ResumeOpenFailed,
	ResumeRenameFailed,
	ResumeSearchFailed,
	sessionIdFromString,
	type ResumeNameFilter,
	type ResumeScope,
	type ResumeSearchSnapshot,
	type ResumeSessionSnapshot,
	type ResumeSortMode,
	type SessionCatalogSnapshot,
	type SessionId,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogService } from "../catalog/catalog-service.ts";
import type { SessionSupervisor } from "./session-supervisor.ts";

export interface ResumeServiceOptions {
	catalogService: Pick<
		CatalogService,
		| "archiveSession"
		| "getSessionCatalog"
		| "getWorkspaceCatalog"
		| "renameSession"
		| "syncWorkspace"
		| "unarchiveSession"
	>;
	now?: () => Date;
	sessionDir?: string;
	sessionSupervisor: Pick<SessionSupervisor, "hasRuntime" | "openSession">;
}

interface ResumeCandidate {
	archivedAt?: string;
	info: SessionInfo;
	isOpen: boolean;
	isRunning: boolean;
	workspaceId: WorkspaceId;
	workspaceName: string;
}

export class ResumeService {
	private readonly catalogService: ResumeServiceOptions["catalogService"];
	private readonly now: () => Date;
	private readonly sessionDir: string | undefined;
	private readonly sessionSupervisor: ResumeServiceOptions["sessionSupervisor"];

	constructor(options: ResumeServiceOptions) {
		this.catalogService = options.catalogService;
		this.now = options.now ?? (() => new Date());
		this.sessionDir = options.sessionDir;
		this.sessionSupervisor = options.sessionSupervisor;
	}

	async search(request: {
		workspaceId: WorkspaceId;
		query: string;
		scope: ResumeScope;
		sortMode: ResumeSortMode;
		nameFilter: ResumeNameFilter;
		includeArchived: boolean;
	}): Promise<ResumeSearchSnapshot> {
		try {
			const candidates = await this.listCandidates(request.workspaceId, request.scope);
			const visibleCandidates = request.includeArchived
				? candidates
				: candidates.filter((candidate) => !candidate.archivedAt);
			const candidateByPath = new Map(visibleCandidates.map((candidate) => [candidate.info.path, candidate]));
			const sortedInfos = filterAndSortSessions(
				visibleCandidates.map((candidate) => candidate.info),
				request.query,
				request.sortMode as SortMode,
				request.nameFilter as NameFilter,
			);
			const results = sortedInfos
				.map((info) => candidateByPath.get(info.path))
				.filter((candidate): candidate is ResumeCandidate => Boolean(candidate))
				.map((candidate) => toResumeSessionSnapshot(candidate));

			return {
				workspaceId: request.workspaceId,
				query: request.query,
				scope: request.scope,
				sortMode: request.sortMode,
				nameFilter: request.nameFilter,
				includeArchived: request.includeArchived,
				results,
				totalCount: candidates.length,
				filteredCount: results.length,
				searchedAt: this.now().toISOString(),
			};
		} catch (error) {
			throw new ResumeSearchFailed({
				workspaceId: request.workspaceId,
				message: "Failed to search Pi sessions",
				cause: getErrorMessage(error),
			});
		}
	}

	async open(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		try {
			await this.catalogService.syncWorkspace(workspaceId);
			return await this.sessionSupervisor.openSession(workspaceId, sessionId);
		} catch (error) {
			throw new ResumeOpenFailed({
				workspaceId,
				sessionId,
				message: `Failed to resume session ${sessionId}`,
				cause: getErrorMessage(error),
			});
		}
	}

	async rename(workspaceId: WorkspaceId, sessionId: SessionId, title: string): Promise<SessionCatalogSnapshot> {
		try {
			await this.catalogService.syncWorkspace(workspaceId);
			return await this.catalogService.renameSession(workspaceId, sessionId, title);
		} catch (error) {
			throw new ResumeRenameFailed({
				workspaceId,
				sessionId,
				message: `Failed to rename session ${sessionId}`,
				cause: getErrorMessage(error),
			});
		}
	}

	async archive(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		try {
			await this.catalogService.syncWorkspace(workspaceId);
			return await this.catalogService.archiveSession(workspaceId, sessionId);
		} catch (error) {
			throw new ResumeArchiveFailed({
				workspaceId,
				sessionId,
				message: `Failed to archive session ${sessionId}`,
				cause: getErrorMessage(error),
			});
		}
	}

	async unarchive(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		try {
			await this.catalogService.syncWorkspace(workspaceId);
			return await this.catalogService.unarchiveSession(workspaceId, sessionId);
		} catch (error) {
			throw new ResumeArchiveFailed({
				workspaceId,
				sessionId,
				message: `Failed to unarchive session ${sessionId}`,
				cause: getErrorMessage(error),
			});
		}
	}

	private async listCandidates(workspaceId: WorkspaceId, scope: ResumeScope): Promise<ResumeCandidate[]> {
		const catalog = await this.catalogService.getWorkspaceCatalog();
		const workspaces =
			scope === "currentWorkspace"
				? catalog.workspaces.filter((workspace) => workspace.id === workspaceId)
				: catalog.workspaces;
		const candidateGroups = await Promise.all(
			workspaces
				.filter((workspace) => !workspace.missing)
				.map((workspace) => this.listWorkspaceCandidates(catalog, workspace.id)),
		);
		return candidateGroups.flat();
	}

	private async listWorkspaceCandidates(
		catalog: WorkspaceCatalogSnapshot,
		workspaceId: WorkspaceId,
	): Promise<ResumeCandidate[]> {
		const sessionCatalog = await this.catalogService.syncWorkspace(workspaceId);
		const workspace = catalog.workspaces.find((entry) => entry.id === workspaceId);
		if (!workspace) return [];
		const canonicalPath = await realpath(workspace.path);
		const sessionDir = this.sessionDir ?? getDefaultSessionDir(canonicalPath);
		if (!(await pathExists(sessionDir))) return [];
		const infos = await SessionManager.list(canonicalPath, sessionDir);
		const catalogById = new Map(sessionCatalog.sessions.map((session) => [session.id, session]));
		return infos.map((info) => {
			const sessionId = sessionIdFromString(info.id);
			const catalogSession = catalogById.get(sessionId);
			const isOpen = this.sessionSupervisor.hasRuntime(workspaceId, sessionId);
			const candidate: ResumeCandidate = {
				info,
				isOpen,
				isRunning: catalogSession?.status === "running" || catalogSession?.status === "cancelling",
				workspaceId,
				workspaceName: workspace.name,
			};
			if (catalogSession?.archivedAt) candidate.archivedAt = catalogSession.archivedAt;
			return candidate;
		});
	}
}

function toResumeSessionSnapshot(candidate: ResumeCandidate): ResumeSessionSnapshot {
	const parentSessionId = candidate.info.parentSessionPath
		? sessionIdFromString(
				basename(candidate.info.parentSessionPath)
					.replace(/\.jsonl$/, "")
					.split("_")
					.at(-1) ?? "",
			)
		: undefined;
	return {
		workspaceId: candidate.workspaceId,
		workspaceName: candidate.workspaceName,
		sessionId: sessionIdFromString(candidate.info.id),
		title: candidate.info.name ?? candidate.info.firstMessage,
		preview: candidate.info.firstMessage,
		messageCount: candidate.info.messageCount,
		updatedAt: candidate.info.modified.toISOString(),
		createdAt: candidate.info.created.toISOString(),
		cwd: candidate.info.cwd,
		sessionFilePath: candidate.info.path,
		...(parentSessionId ? { parentSessionId } : {}),
		...(candidate.archivedAt ? { archivedAt: candidate.archivedAt } : {}),
		isOpen: candidate.isOpen,
		isRunning: candidate.isRunning,
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
