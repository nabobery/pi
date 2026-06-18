import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SessionManager } from "../../../../coding-agent/src/core/session-manager.ts";
import { WorkspaceNotFound, sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { CatalogService } from "../../../src/main/catalog/catalog-service.ts";
import { JsonCatalogStore } from "../../../src/main/catalog/json-catalog-store.ts";

describe("CatalogService", () => {
	let tempDir: string;
	let workspaceDir: string;
	let catalogPath: string;
	let sessionDir: string;
	let service: CatalogService;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "pi-gui-catalog-service-"));
		workspaceDir = join(tempDir, "workspace");
		sessionDir = join(tempDir, "sessions");
		mkdirSync(workspaceDir, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
		catalogPath = join(tempDir, "catalog.json");
		service = new CatalogService({ sessionDir, store: new JsonCatalogStore({ catalogPath }) });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("rejects invalid workspace paths", async () => {
		await expect(service.addWorkspace(join(tempDir, "missing"))).rejects.toMatchObject({
			_tag: "InvalidWorkspacePath",
		});
	});

	test("adds and selects a canonical workspace", async () => {
		const { workspaces } = await service.addWorkspace(workspaceDir);

		expect(workspaces).toHaveLength(1);
		expect(workspaces[0]).toMatchObject({
			path: realpathSync(workspaceDir),
			name: "workspace",
			missing: false,
			selected: true,
		});
		expect(workspaces[0].id).toBeTruthy();
	});

	test("syncs sessions from Pi session storage and preserves archive metadata", async () => {
		const workspaceCatalog = await service.addWorkspace(workspaceDir);
		const workspace = workspaceCatalog.workspaces[0];
		const session = SessionManager.create(workspace.path, sessionDir);
		session.ensureSessionFile();
		session.appendSessionInfo("Archived session");
		const sessionFile = session.getSessionFile();
		expect(sessionFile).toBeDefined();

		let sessions = await service.syncWorkspace(workspace.id);
		expect(sessions.sessions).toHaveLength(1);
		const sessionId = sessions.sessions[0].id;

		await service.archiveSession(workspace.id, sessionId);
		sessions = await service.syncWorkspace(workspace.id);

		expect(sessions.sessions[0]).toMatchObject({
			id: sessionId,
			workspaceId: workspace.id,
			title: "Archived session",
			status: "idle",
			sessionFilePath: sessionFile,
		});
		expect(sessions.sessions[0].archivedAt).toBeDefined();
	});

	test("removes disappeared session entries without deleting transcript files", async () => {
		const workspaceCatalog = await service.addWorkspace(workspaceDir);
		const workspace = workspaceCatalog.workspaces[0];
		const session = SessionManager.create(workspace.path, sessionDir);
		session.ensureSessionFile();
		const sessionFile = session.getSessionFile();
		expect(sessionFile).toBeDefined();

		await service.syncWorkspace(workspace.id);
		await service.removeWorkspace(workspace.id);

		expect(existsSync(sessionFile!)).toBe(true);
		expect((await service.getSessionCatalog(workspace.id)).sessions).toEqual([]);
	});

	test("creates a real file-backed session and selects it", async () => {
		const workspaceCatalog = await service.addWorkspace(workspaceDir);
		const workspace = workspaceCatalog.workspaces[0];

		const sessions = await service.createSession(workspace.id);

		expect(sessions.selectedSessionId).toBe(sessions.sessions[0].id);
		expect(sessions.sessions[0]).toMatchObject({
			workspaceId: workspace.id,
			title: "New session",
			status: "idle",
			messageCount: 0,
		});
		expect(sessions.sessions[0].sessionFilePath).toBeDefined();
		expect(existsSync(sessions.sessions[0].sessionFilePath!)).toBe(true);
	});

	test("opens, renames, archives, and unarchives catalog sessions", async () => {
		const workspaceCatalog = await service.addWorkspace(workspaceDir);
		const workspace = workspaceCatalog.workspaces[0];
		let sessions = await service.createSession(workspace.id);
		const session = sessions.sessions[0];

		sessions = await service.openSession(workspace.id, session.id);
		expect(sessions.selectedSessionId).toBe(session.id);

		sessions = await service.renameSession(workspace.id, session.id, "Renamed session");
		expect(sessions.sessions[0].title).toBe("Renamed session");
		expect(readFileSync(session.sessionFilePath!, "utf8")).toContain('"name":"Renamed session"');

		sessions = await service.archiveSession(workspace.id, session.id);
		expect(sessions.sessions[0].archivedAt).toBeDefined();

		sessions = await service.unarchiveSession(workspace.id, session.id);
		expect(sessions.sessions[0].archivedAt).toBeUndefined();
	});

	test("scopes session mutation by workspace when Pi session ids collide", async () => {
		const otherWorkspaceDir = join(tempDir, "other-workspace");
		mkdirSync(otherWorkspaceDir, { recursive: true });
		const firstWorkspace = (await service.addWorkspace(workspaceDir)).workspaces[0];
		const secondWorkspace = (await service.addWorkspace(otherWorkspaceDir)).workspaces.find(
			(workspace) => workspace.path === realpathSync(otherWorkspaceDir),
		);
		expect(secondWorkspace).toBeDefined();
		if (!secondWorkspace) return;

		const firstSession = SessionManager.create(firstWorkspace.path, sessionDir, { id: "shared-session" });
		firstSession.ensureSessionFile();
		firstSession.appendSessionInfo("First workspace");
		await waitForDistinctSessionFileTimestamp();
		const secondSession = SessionManager.create(secondWorkspace.path, sessionDir, { id: "shared-session" });
		secondSession.ensureSessionFile();
		secondSession.appendSessionInfo("Second workspace");

		await service.syncWorkspace(firstWorkspace.id);
		await service.syncWorkspace(secondWorkspace.id);
		await service.renameSession(
			secondWorkspace.id,
			sessionIdFromString(firstSession.getSessionId()),
			"Renamed second workspace",
		);

		const firstCatalog = await service.getSessionCatalog(firstWorkspace.id);
		const secondCatalog = await service.getSessionCatalog(secondWorkspace.id);
		expect(firstCatalog.sessions[0].title).toBe("First workspace");
		expect(secondCatalog.sessions[0].title).toBe("Renamed second workspace");
		expect(readFileSync(firstSession.getSessionFile()!, "utf8")).toContain('"name":"First workspace"');
		expect(readFileSync(secondSession.getSessionFile()!, "utf8")).toContain('"name":"Renamed second workspace"');
	});

	test("does not clear missing state on select and rejects create when workspace path disappeared", async () => {
		const workspace = (await service.addWorkspace(workspaceDir)).workspaces[0];
		rmSync(workspace.path, { recursive: true, force: true });

		await expect(service.syncWorkspace(workspace.id)).rejects.toMatchObject({ _tag: "WorkspacePathMissing" });
		const selectedCatalog = await service.selectWorkspace(workspace.id);
		expect(selectedCatalog.workspaces[0]).toMatchObject({ missing: true, selected: true });
		await expect(service.createSession(workspace.id)).rejects.toMatchObject({ _tag: "WorkspacePathMissing" });
		expect((await service.getWorkspaceCatalog()).workspaces[0].missing).toBe(true);
	});

	test("throws WorkspaceNotFound for unknown workspaces", async () => {
		await expect(service.syncWorkspace(workspaceIdFromString("unknown-workspace"))).rejects.toBeInstanceOf(
			WorkspaceNotFound,
		);
	});
});

function waitForDistinctSessionFileTimestamp(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 2));
}
