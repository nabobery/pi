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
