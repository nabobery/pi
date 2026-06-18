import { describe, expect, test, vi } from "vitest";
import {
	SessionCatalogUpdated,
	SessionSelected,
	type GuiEvent,
	InternalIpcError,
	SessionCreate,
	WorkspaceCatalogUpdated,
	catalogRevisionFromString,
	eventIdFromString,
	requestIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../src/contracts/index.ts";
import { createGuiCatalogStore, createValidatedRendererCatalogApi } from "../../src/renderer/app/app-store.ts";

describe("createGuiCatalogStore", () => {
	test("applies workspace and session catalog events", () => {
		const listeners: Array<(event: GuiEvent) => void> = [];
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					listeners.push(listener);
					return () => undefined;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		listeners[0](
			new WorkspaceCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				catalog: {
					revision: catalogRevisionFromString("1"),
					selectedWorkspaceId: workspaceId,
					workspaces: [
						{
							id: workspaceId,
							path: "/tmp/workspace",
							name: "workspace",
							lastOpenedAt: "2026-06-18T00:00:00.000Z",
							sortOrder: 0,
							missing: false,
							selected: true,
						},
					],
				},
			}),
		);
		listeners[0](
			new SessionCatalogUpdated({
				eventId: eventIdFromString("event-2"),
				sequence: 2,
				workspaceId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session",
						status: "idle",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "hello",
						messageCount: 1,
					},
				],
			}),
		);
		listeners[0](
			new SessionSelected({
				eventId: eventIdFromString("event-3"),
				sequence: 3,
				workspaceId,
				sessionId,
			}),
		);

		expect(store.getSnapshot()).toMatchObject({
			workspaceCatalog: {
				selectedWorkspaceId: workspaceId,
				workspaces: [expect.objectContaining({ id: workspaceId })],
			},
			sessionCatalogs: {
				[workspaceId]: {
					selectedSessionId: sessionId,
					sessions: [expect.objectContaining({ id: sessionId, title: "Session" })],
				},
			},
		});
	});

	test("keeps the IPC subscription alive across React listener cleanup and resubscribe", () => {
		const eventListeners: Array<(event: GuiEvent) => void> = [];
		const unsubscribeIpc = vi.fn();
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: (listener) => {
					eventListeners.push(listener);
					return unsubscribeIpc;
				},
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
		);
		const firstListener = vi.fn();
		const secondListener = vi.fn();
		const workspaceId = workspaceIdFromString("workspace-1");

		const unsubscribeFirst = store.subscribe(firstListener);
		unsubscribeFirst();
		const unsubscribeSecond = store.subscribe(secondListener);
		eventListeners[0](
			new WorkspaceCatalogUpdated({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				catalog: {
					revision: catalogRevisionFromString("1"),
					selectedWorkspaceId: workspaceId,
					workspaces: [
						{
							id: workspaceId,
							path: "/tmp/workspace",
							name: "workspace",
							lastOpenedAt: "2026-06-18T00:00:00.000Z",
							sortOrder: 0,
							missing: false,
							selected: true,
						},
					],
				},
			}),
		);
		unsubscribeSecond();

		expect(unsubscribeIpc).not.toHaveBeenCalled();
		expect(secondListener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot().workspaceCatalog.selectedWorkspaceId).toBe(workspaceId);
	});

	test("seeds initial errors from bootstrap warnings", () => {
		const store = createGuiCatalogStore(
			{
				invoke: vi.fn(),
				subscribe: () => () => undefined,
			},
			{ revision: catalogRevisionFromString("0"), workspaces: [] },
			{ initialError: "Failed to parse GUI catalog" },
		);

		expect(store.getSnapshot().error).toBe("Failed to parse GUI catalog");
	});

	test("validates invoke results before applying renderer state", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const api = createValidatedRendererCatalogApi({
			invoke: vi.fn().mockResolvedValue({
				ok: true,
				requestId: "",
				data: {
					workspaceId,
					sessions: [],
				},
			}),
			subscribe: () => () => undefined,
		});

		const result = await api.invoke(
			new SessionCreate({
				requestId: requestIdFromString("request-1"),
				workspaceId,
			}),
		);

		expect(result).toMatchObject({
			ok: false,
			requestId: "request-1",
			error: {
				_tag: "InternalIpcError",
				message: "Invalid GUI command result",
				cause: expect.any(String),
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBeInstanceOf(InternalIpcError);
	});

	test("drops malformed event payloads before they reach the store", async () => {
		let eventListener: ((event: unknown) => void) | undefined;
		const listener = vi.fn();
		const api = createValidatedRendererCatalogApi({
			invoke: vi.fn(),
			subscribe: (nextListener) => {
				eventListener = nextListener;
				return () => undefined;
			},
		});
		api.subscribe(listener);

		eventListener?.({
			_tag: "workspace.catalogUpdated",
			eventId: "",
			sequence: 1,
			catalog: { revision: "1", workspaces: [] },
		});
		await Promise.resolve();

		expect(listener).not.toHaveBeenCalled();
	});
});
