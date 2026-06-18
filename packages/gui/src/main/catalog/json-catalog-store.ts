import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Effect, Schema } from "effect";
import {
	CatalogParseFailed,
	CatalogReadFailed,
	CatalogWriteFailed,
	SessionSnapshot,
	WorkspaceSnapshot,
	catalogRevisionFromString,
} from "../../contracts/index.ts";
import { CatalogRevision, SessionId, WorkspaceId } from "../../contracts/index.ts";

export const CatalogFileState = Schema.Struct({
	version: Schema.Literal(1),
	revision: CatalogRevision,
	selectedWorkspaceId: Schema.optional(WorkspaceId),
	selectedSessionByWorkspace: Schema.Record({ key: Schema.String, value: SessionId }),
	workspaces: Schema.Array(WorkspaceSnapshot),
	sessions: Schema.Array(SessionSnapshot),
});
export type CatalogFileState = Schema.Schema.Type<typeof CatalogFileState>;

export interface JsonCatalogStoreOptions {
	catalogPath?: string;
}

export class JsonCatalogStore {
	private readonly catalogPath: string;
	private state: CatalogFileState | undefined;
	private loadPromise: Promise<CatalogFileState> | undefined;
	private startupWarning: CatalogParseFailed | undefined;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(options: JsonCatalogStoreOptions = {}) {
		this.catalogPath = options.catalogPath ?? defaultCatalogPath();
	}

	getPath(): string {
		return this.catalogPath;
	}

	getStartupWarning(): CatalogParseFailed | undefined {
		return this.startupWarning;
	}

	async read(): Promise<CatalogFileState> {
		return cloneState(await this.getState());
	}

	async update(mutator: (state: CatalogFileState) => CatalogFileState): Promise<CatalogFileState> {
		let nextState: CatalogFileState | undefined;
		const operation = this.writeQueue.then(async () => {
			const current = await this.getState();
			nextState = normalizeState(mutator(cloneState(current)));
			await this.persist(nextState);
			this.state = nextState;
		});
		this.writeQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		await operation;
		return cloneState(nextState ?? createEmptyState());
	}

	private async getState(): Promise<CatalogFileState> {
		if (this.state) return this.state;
		if (!this.loadPromise) {
			this.loadPromise = this.loadState();
		}
		this.state = await this.loadPromise;
		return this.state;
	}

	private async loadState(): Promise<CatalogFileState> {
		let raw: string;
		try {
			raw = await readFile(this.catalogPath, "utf8");
		} catch (error) {
			if (isMissingFileError(error)) return createEmptyState();
			throw new CatalogReadFailed({
				message: `Failed to read GUI catalog: ${this.catalogPath}`,
				cause: getErrorMessage(error),
			});
		}

		try {
			const parsed: unknown = JSON.parse(raw);
			return normalizeState(await Effect.runPromise(Schema.decodeUnknown(CatalogFileState)(parsed)));
		} catch (error) {
			const backupPath = await this.backupInvalidCatalog();
			this.startupWarning = new CatalogParseFailed({
				message: `Failed to parse GUI catalog: ${this.catalogPath}`,
				cause: getErrorMessage(error),
				backupPath,
			});
			return createEmptyState();
		}
	}

	private async backupInvalidCatalog(): Promise<string | undefined> {
		const backupPath = `${this.catalogPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.invalid`;
		try {
			await rename(this.catalogPath, backupPath);
			return backupPath;
		} catch {
			return undefined;
		}
	}

	private async persist(state: CatalogFileState): Promise<void> {
		try {
			await mkdir(dirname(this.catalogPath), { recursive: true });
			const tempPath = `${this.catalogPath}.${process.pid}.${Date.now()}.tmp`;
			await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
			await rename(tempPath, this.catalogPath);
		} catch (error) {
			throw new CatalogWriteFailed({
				message: `Failed to write GUI catalog: ${this.catalogPath}`,
				cause: getErrorMessage(error),
			});
		}
	}
}

export function defaultCatalogPath(): string {
	return join(homedir(), ".pi", "gui", "catalog.json");
}

function createEmptyState(): CatalogFileState {
	return {
		version: 1,
		revision: catalogRevisionFromString("0"),
		selectedSessionByWorkspace: {},
		workspaces: [],
		sessions: [],
	};
}

function normalizeState(state: CatalogFileState): CatalogFileState {
	return {
		version: 1,
		revision: state.revision,
		...(state.selectedWorkspaceId ? { selectedWorkspaceId: state.selectedWorkspaceId } : {}),
		selectedSessionByWorkspace: { ...state.selectedSessionByWorkspace },
		workspaces: [...state.workspaces].sort(compareWorkspaces),
		sessions: [...state.sessions].sort(compareSessions),
	};
}

function cloneState(state: CatalogFileState): CatalogFileState {
	return {
		version: 1,
		revision: state.revision,
		...(state.selectedWorkspaceId ? { selectedWorkspaceId: state.selectedWorkspaceId } : {}),
		selectedSessionByWorkspace: { ...state.selectedSessionByWorkspace },
		workspaces: state.workspaces.map((workspace) => ({ ...workspace })),
		sessions: state.sessions.map((session) => ({ ...session })),
	};
}

function compareWorkspaces(left: WorkspaceSnapshot, right: WorkspaceSnapshot): number {
	if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
	return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
}

function compareSessions(left: SessionSnapshot, right: SessionSnapshot): number {
	if (Boolean(left.archivedAt) !== Boolean(right.archivedAt)) {
		return left.archivedAt ? 1 : -1;
	}
	return right.updatedAt.localeCompare(left.updatedAt);
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR")
	);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
