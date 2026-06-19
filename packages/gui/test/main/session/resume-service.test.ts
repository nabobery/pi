import { describe, expect, test, vi } from "vitest";
import {
	ResumeSearchFailed,
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../../src/contracts/index.ts";
import { ResumeService } from "../../../src/main/session/resume-service.ts";

const runtimeMocks = vi.hoisted(() => ({
	filterAndSortSessions: vi.fn((sessions: unknown[]) => sessions),
	getDefaultSessionDir: vi.fn(() => "/tmp/workspace/.pi/sessions"),
	list: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
	access: vi.fn(async () => undefined),
	realpath: vi.fn(async (path: string) => path),
}));

vi.mock("@earendil-works/pi-coding-agent/runtime", () => ({
	filterAndSortSessions: runtimeMocks.filterAndSortSessions,
	getDefaultSessionDir: runtimeMocks.getDefaultSessionDir,
	SessionManager: { list: runtimeMocks.list },
}));

vi.mock("node:fs/promises", () => ({
	access: fsMocks.access,
	realpath: fsMocks.realpath,
}));

describe("ResumeService", () => {
	test("searches current workspace sessions through Pi session listing", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		runtimeMocks.list.mockResolvedValueOnce([
			{
				path: "/tmp/workspace/.pi/sessions/session_session-1.jsonl",
				id: sessionId,
				cwd: "/tmp/workspace",
				name: "Named session",
				created: new Date("2026-06-18T00:00:00.000Z"),
				modified: new Date("2026-06-19T00:00:00.000Z"),
				messageCount: 3,
				firstMessage: "hello",
				allMessagesText: "hello from transcript",
			},
		]);
		const catalogService = catalogServiceStub(workspaceId, sessionId);
		const service = new ResumeService({
			catalogService,
			now: () => new Date("2026-06-19T01:00:00.000Z"),
			sessionSupervisor: {
				hasRuntime: vi.fn(() => true),
				openSession: vi.fn(async () => catalogService.getSessionCatalog()),
			},
		});

		const snapshot = await service.search({
			workspaceId,
			query: "hello",
			scope: "currentWorkspace",
			sortMode: "threaded",
			nameFilter: "all",
			includeArchived: false,
		});

		expect(runtimeMocks.filterAndSortSessions).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: sessionId })]),
			"hello",
			"threaded",
			"all",
		);
		expect(snapshot).toMatchObject({
			workspaceId,
			query: "hello",
			totalCount: 1,
			filteredCount: 1,
			results: [
				expect.objectContaining({
					workspaceId,
					sessionId,
					title: "Named session",
					isOpen: true,
					isRunning: true,
				}),
			],
		});
	});

	test("wraps search failures in a typed resume error", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		runtimeMocks.list.mockRejectedValueOnce(new Error("list failed"));
		const service = new ResumeService({
			catalogService: catalogServiceStub(workspaceId, sessionIdFromString("session-1")),
			sessionSupervisor: {
				hasRuntime: vi.fn(() => false),
				openSession: vi.fn(),
			},
		});

		await expect(
			service.search({
				workspaceId,
				query: "",
				scope: "currentWorkspace",
				sortMode: "threaded",
				nameFilter: "all",
				includeArchived: false,
			}),
		).rejects.toBeInstanceOf(ResumeSearchFailed);
	});

	test("delegates open, rename, archive, and unarchive through catalog and supervisor services", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const catalogService = catalogServiceStub(workspaceId, sessionId);
		const sessionSupervisor = {
			hasRuntime: vi.fn(() => false),
			openSession: vi.fn(async () => catalogService.getSessionCatalog()),
		};
		const service = new ResumeService({ catalogService, sessionSupervisor });

		await service.open(workspaceId, sessionId);
		await service.rename(workspaceId, sessionId, "Renamed");
		await service.archive(workspaceId, sessionId);
		await service.unarchive(workspaceId, sessionId);

		expect(catalogService.syncWorkspace).toHaveBeenCalledTimes(4);
		expect(sessionSupervisor.openSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(catalogService.renameSession).toHaveBeenCalledWith(workspaceId, sessionId, "Renamed");
		expect(catalogService.archiveSession).toHaveBeenCalledWith(workspaceId, sessionId);
		expect(catalogService.unarchiveSession).toHaveBeenCalledWith(workspaceId, sessionId);
	});
});

function catalogServiceStub(
	workspaceId: ReturnType<typeof workspaceIdFromString>,
	sessionId: ReturnType<typeof sessionIdFromString>,
) {
	const sessionCatalog = {
		workspaceId,
		selectedSessionId: sessionId,
		sessions: [
			{
				id: sessionId,
				workspaceId,
				title: "Session",
				status: "running" as const,
				updatedAt: "2026-06-19T00:00:00.000Z",
				preview: "hello",
				messageCount: 3,
				sessionFilePath: "/tmp/workspace/.pi/sessions/session_session-1.jsonl",
			},
		],
	};
	return {
		archiveSession: vi.fn(async () => sessionCatalog),
		getSessionCatalog: vi.fn(async () => sessionCatalog),
		getWorkspaceCatalog: vi.fn(async () => ({
			revision: catalogRevisionFromString("1"),
			selectedWorkspaceId: workspaceId,
			workspaces: [
				{
					id: workspaceId,
					path: "/tmp/workspace",
					name: "workspace",
					lastOpenedAt: "2026-06-19T00:00:00.000Z",
					sortOrder: 0,
					missing: false,
					selected: true,
				},
			],
		})),
		renameSession: vi.fn(async () => sessionCatalog),
		syncWorkspace: vi.fn(async () => sessionCatalog),
		unarchiveSession: vi.fn(async () => sessionCatalog),
	};
}
