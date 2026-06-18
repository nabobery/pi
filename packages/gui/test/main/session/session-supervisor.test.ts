import { describe, expect, test, vi } from "vitest";
import {
	SessionRuntimeCloseFailed,
	SessionRuntimeNotFound,
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type GuiEvent,
	type SessionCatalogSnapshot,
	type TimelineSnapshot,
	type WorkspaceCatalogSnapshot,
	eventIdFromString,
} from "../../../src/contracts/index.ts";
import type { RuntimeSessionHandle, SessionDriver } from "../../../src/main/session/session-driver.ts";
import { SessionSupervisor } from "../../../src/main/session/session-supervisor.ts";

describe("SessionSupervisor", () => {
	test("opens runtime records with workspace-scoped keys and emits opening, opened, and ready events", async () => {
		const fixture = createSupervisorFixture();

		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-b"), sessionIdFromString("session-1"));

		expect(fixture.driver.openSession).toHaveBeenCalledTimes(2);
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(true);
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-b"), sessionIdFromString("session-1")),
		).toBe(true);
		expect(fixture.events.map((event) => event._tag)).toEqual([
			"session.statusChanged",
			"session.opened",
			"session.statusChanged",
			"session.statusChanged",
			"session.opened",
			"session.statusChanged",
		]);
		expect(fixture.events[0]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "opening" },
		});
		expect(fixture.events[2]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "ready" },
		});
	});

	test("returns static transcript snapshots from the managed runtime", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		const snapshot = await fixture.supervisor.getTranscript(
			workspaceIdFromString("workspace-a"),
			sessionIdFromString("session-1"),
		);

		expect(snapshot).toEqual({
			workspaceId: "workspace-a",
			sessionId: "session-1",
			entries: [{ id: "entry-1", kind: "user", text: "hello" }],
		});
	});

	test("close unsubscribes, disposes, removes the runtime record, and emits closed", async () => {
		const fixture = createSupervisorFixture();
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await fixture.supervisor.closeSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
		expect(fixture.driver.closeSession).toHaveBeenCalledTimes(1);
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(false);
		expect(fixture.events.at(-1)).toMatchObject({
			_tag: "session.closed",
			workspaceId: "workspace-a",
			sessionId: "session-1",
		});
	});

	test("getTranscript returns a typed error when the runtime is not open", async () => {
		const fixture = createSupervisorFixture();

		await expect(
			fixture.supervisor.getTranscript(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toBeInstanceOf(SessionRuntimeNotFound);
	});

	test("open failure emits failed status and does not keep a runtime record", async () => {
		const fixture = createSupervisorFixture();
		fixture.driver.openSession = vi.fn(async () => {
			throw new Error("open failed");
		});

		await expect(
			fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toThrow("open failed");

		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(false);
		expect(fixture.events.map((event) => event._tag)).toEqual(["session.statusChanged", "session.statusChanged"]);
		expect(fixture.events[0]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "opening" },
		});
		expect(fixture.events[1]).toMatchObject({
			_tag: "session.statusChanged",
			session: { workspaceId: "workspace-a", id: "session-1", status: "failed" },
		});
	});

	test("close failure keeps subscription and runtime record without emitting closed", async () => {
		const fixture = createSupervisorFixture();
		fixture.driver.closeSession = vi.fn(async () => {
			throw new SessionRuntimeCloseFailed({
				workspaceId: "workspace-a",
				sessionId: "session-1",
				sessionFilePath: "/tmp/workspace-a/session-1.jsonl",
				message: "Failed to close Pi session runtime",
			});
		});
		await fixture.supervisor.openSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1"));

		await expect(
			fixture.supervisor.closeSession(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).rejects.toBeInstanceOf(SessionRuntimeCloseFailed);

		expect(fixture.unsubscribe).not.toHaveBeenCalled();
		expect(
			fixture.supervisor.hasRuntime(workspaceIdFromString("workspace-a"), sessionIdFromString("session-1")),
		).toBe(true);
		expect(fixture.events.map((event) => event._tag)).not.toContain("session.closed");
	});
});

function createSupervisorFixture() {
	const workspaceCatalog: WorkspaceCatalogSnapshot = {
		revision: catalogRevisionFromString("1"),
		selectedWorkspaceId: workspaceIdFromString("workspace-a"),
		workspaces: [
			{
				id: workspaceIdFromString("workspace-a"),
				path: "/tmp/workspace-a",
				name: "workspace-a",
				lastOpenedAt: "2026-06-18T00:00:00.000Z",
				sortOrder: 0,
				missing: false,
			},
			{
				id: workspaceIdFromString("workspace-b"),
				path: "/tmp/workspace-b",
				name: "workspace-b",
				lastOpenedAt: "2026-06-18T00:00:00.000Z",
				sortOrder: 1,
				missing: false,
			},
		],
	};
	const catalogService = {
		createSession: vi.fn((workspaceId) => Promise.resolve(createSessionCatalog(workspaceId))),
		getWorkspaceCatalog: vi.fn(() => Promise.resolve(workspaceCatalog)),
		openSession: vi.fn((workspaceId) => Promise.resolve(createSessionCatalog(workspaceId))),
	};
	const unsubscribe = vi.fn();
	const driver: SessionDriver = {
		openSession: vi.fn(async (request) => createHandle(request.workspaceId, request.workspacePath)),
		closeSession: vi.fn(async () => undefined),
		getTranscript: vi.fn(
			async (handle): Promise<TimelineSnapshot> => ({
				workspaceId: handle.workspaceId,
				sessionId: handle.sessionId,
				entries: [{ id: "entry-1", kind: "user", text: "hello" }],
			}),
		),
		subscribe: vi.fn(() => unsubscribe),
	};
	const events: GuiEvent[] = [];
	let sequence = 0;
	const eventBus = {
		nextEventBase: () => {
			sequence += 1;
			return { eventId: eventIdFromString(`event-${sequence}`), sequence };
		},
		publish: (event: GuiEvent) => {
			events.push(event);
		},
	};

	return {
		driver,
		events,
		supervisor: new SessionSupervisor({ catalogService, driver, eventBus }),
		unsubscribe,
	};
}

function createSessionCatalog(workspaceId: string): SessionCatalogSnapshot {
	return {
		workspaceId: workspaceIdFromString(workspaceId),
		selectedSessionId: sessionIdFromString("session-1"),
		sessions: [
			{
				id: sessionIdFromString("session-1"),
				workspaceId: workspaceIdFromString(workspaceId),
				title: "Session",
				status: "idle",
				updatedAt: "2026-06-18T00:00:00.000Z",
				preview: "",
				messageCount: 1,
				sessionFilePath: `/tmp/${workspaceId}/session-1.jsonl`,
			},
		],
	};
}

function createHandle(workspaceId: string, workspacePath: string): RuntimeSessionHandle {
	return {
		key: `${workspaceId}:session-1`,
		runtime: {
			session: { bindExtensions: vi.fn() },
			dispose: vi.fn(),
		},
		sessionFilePath: `/tmp/${workspaceId}/session-1.jsonl`,
		sessionId: sessionIdFromString("session-1"),
		sessionManager: { getEntries: () => [], getSessionId: () => "session-1" },
		workspaceId: workspaceIdFromString(workspaceId),
		workspacePath,
	};
}
