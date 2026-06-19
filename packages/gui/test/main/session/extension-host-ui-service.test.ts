import { afterEach, describe, expect, test, vi } from "vitest";
import {
	ExtensionUiRequestNotFound,
	ExtensionUiResponseInvalid,
	ExtensionUiSessionMismatch,
	eventIdFromString,
	extensionUiRequestIdFromString,
	type GuiEvent,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../../src/contracts/index.ts";
import { ExtensionHostUiService } from "../../../src/main/session/extension-host-ui-service.ts";

describe("ExtensionHostUiService", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("resolves confirm responses and publishes requested/resolved events", async () => {
		const fixture = createFixture();
		const context = fixture.service.createContext(
			workspaceIdFromString("workspace-1"),
			sessionIdFromString("session-1"),
		);

		const result = context.confirm("Continue", "Run extension?");
		const request = getRequestedEvent(fixture.events).request;
		fixture.service.respond({
			workspaceId: request.workspaceId,
			sessionId: request.sessionId,
			extensionUiRequestId: request.id,
			response: { kind: "confirm", confirmed: true },
		});

		await expect(result).resolves.toBe(true);
		expect(fixture.events.map((event) => event._tag)).toEqual(["extensionUi.requested", "extensionUi.resolved"]);
	});

	test("rejects wrong response kinds without resolving the pending request", async () => {
		const fixture = createFixture();
		const context = fixture.service.createContext(
			workspaceIdFromString("workspace-1"),
			sessionIdFromString("session-1"),
		);

		void context.input("Name");
		const request = getRequestedEvent(fixture.events).request;

		expect(() =>
			fixture.service.respond({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				extensionUiRequestId: request.id,
				response: { kind: "confirm", confirmed: true },
			}),
		).toThrow(ExtensionUiResponseInvalid);
	});

	test("distinguishes wrong-session responses from unrelated missing requests", () => {
		const fixture = createFixture();
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionA = sessionIdFromString("session-a");
		const sessionB = sessionIdFromString("session-b");
		const context = fixture.service.createContext(workspaceId, sessionB);

		void context.input("Name");
		const request = getRequestedEvent(fixture.events).request;

		expect(() =>
			fixture.service.respond({
				workspaceId,
				sessionId: sessionA,
				extensionUiRequestId: request.id,
				response: { kind: "input", value: "Ada", cancelled: false },
			}),
		).toThrow(ExtensionUiSessionMismatch);
		expect(() =>
			fixture.service.respond({
				workspaceId,
				sessionId: sessionA,
				extensionUiRequestId: extensionUiRequestIdFromString("extension-ui-missing"),
				response: { kind: "input", value: "Ada", cancelled: false },
			}),
		).toThrow(ExtensionUiRequestNotFound);
	});

	test("timeout and abort resolve with safe default values and cleanup pending requests", async () => {
		vi.useFakeTimers();
		const fixture = createFixture();
		const context = fixture.service.createContext(
			workspaceIdFromString("workspace-1"),
			sessionIdFromString("session-1"),
		);
		const controller = new AbortController();

		const timedOut = context.select("Pick", ["one"], { timeout: 10 });
		await vi.advanceTimersByTimeAsync(10);
		await expect(timedOut).resolves.toBeUndefined();
		expect(fixture.events.at(-1)).toMatchObject({ _tag: "extensionUi.resolved" });

		const aborted = context.confirm("Continue", "Run?", { signal: controller.signal });
		controller.abort();
		await expect(aborted).resolves.toBe(false);
		expect(fixture.events.at(-1)).toMatchObject({ _tag: "extensionUi.resolved" });
	});

	test("mirrors renderer editor text for synchronous getEditorText calls", () => {
		const fixture = createFixture();
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const context = fixture.service.createContext(workspaceId, sessionId);

		fixture.service.updateEditorText(workspaceId, sessionId, "renderer draft");

		expect(context.getEditorText()).toBe("renderer draft");
	});

	test("publishes inline updates and compatibility issues for unsupported rich UI methods", async () => {
		const fixture = createFixture();
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const context = fixture.service.createContext(workspaceId, sessionId);
		const autocompleteFactory = undefined as unknown as Parameters<typeof context.addAutocompleteProvider>[0];
		const customFactory = undefined as unknown as Parameters<typeof context.custom>[0];

		context.notify("Heads up", "warning");
		context.setStatus("build", "running");
		context.setTitle("Extension title");
		context.setEditorText("draft");
		context.pasteToEditor(" plus");
		context.setWorkingVisible(true);
		context.setWorkingMessage("Working");
		context.setWorkingIndicator();
		context.setHiddenThinkingLabel("Thinking");
		context.setWidget("widget", ["line"]);
		context.setFooter(undefined);
		context.setHeader(undefined);
		context.addAutocompleteProvider(autocompleteFactory);
		context.setEditorComponent(undefined);
		context.setToolsExpanded(true);
		expect(context.getEditorComponent()).toBeUndefined();
		expect(context.getAllThemes()).toEqual([]);
		expect(context.getTheme("missing")).toBeUndefined();
		expect(context.getToolsExpanded()).toBe(false);
		expect(context.setTheme("dark")).toEqual({
			success: false,
			error: "Theme mutation is not supported in Pi GUI",
		});
		await expect(context.custom(customFactory)).rejects.toThrow("Custom extension UI is not supported in Pi GUI");
		expect((context.theme as unknown as Record<string, string>).background).toBe("");

		expect(fixture.events.map((event) => event._tag)).toContain("extensionUi.updated");
		expect(fixture.events.map((event) => event._tag)).toContain("extensionUi.compatibilityIssue");
		expect(fixture.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					_tag: "extensionUi.updated",
					update: expect.objectContaining({ kind: "notify" }),
				}),
				expect.objectContaining({
					_tag: "extensionUi.updated",
					update: expect.objectContaining({ kind: "status" }),
				}),
				expect.objectContaining({
					_tag: "extensionUi.updated",
					update: expect.objectContaining({ kind: "title" }),
				}),
				expect.objectContaining({
					_tag: "extensionUi.updated",
					update: expect.objectContaining({ kind: "editorText", editorText: "draft plus" }),
				}),
				expect.objectContaining({ _tag: "extensionUi.compatibilityIssue", method: "setWorkingVisible" }),
				expect.objectContaining({ _tag: "extensionUi.compatibilityIssue", method: "theme" }),
			]),
		);
	});

	test("cancels pending session requests and clears mirrored editor text", async () => {
		const fixture = createFixture();
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const context = fixture.service.createContext(workspaceId, sessionId);

		const input = context.input("Name");
		const confirm = context.confirm("Continue", "Run?");
		fixture.service.updateEditorText(workspaceId, sessionId, "draft");
		fixture.service.cancelSessionRequests(workspaceId, sessionId);

		await expect(input).resolves.toBeUndefined();
		await expect(confirm).resolves.toBe(false);
		expect(context.getEditorText()).toBe("");
		expect(fixture.events.filter((event) => event._tag === "extensionUi.resolved")).toHaveLength(2);
	});
});

function createFixture() {
	const events: GuiEvent[] = [];
	let sequence = 0;
	const service = new ExtensionHostUiService({
		nextEventBase: () => {
			sequence += 1;
			return { eventId: eventIdFromString(`event-${sequence}`), sequence };
		},
		publish: (event) => {
			events.push(event);
		},
	});
	return { events, service };
}

function getRequestedEvent(events: readonly GuiEvent[]) {
	const event = events.find((entry) => entry._tag === "extensionUi.requested");
	if (!event || event._tag !== "extensionUi.requested") throw new Error("Expected extension UI request");
	return event;
}
