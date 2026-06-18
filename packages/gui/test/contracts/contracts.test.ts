import { describe, expect, test } from "vitest";
import {
	AppBootstrap,
	AppReady,
	CommandNotImplemented,
	GuiCommand,
	GuiError,
	GuiEvent,
	ReceiptEmitted,
	decodeGuiCommand,
	decodeGuiError,
	decodeGuiEvent,
	eventIdFromString,
	requestIdFromString,
	workspaceIdFromString,
} from "../../src/contracts/index.ts";

describe("gui contracts", () => {
	test("decodes valid commands", async () => {
		const command = await decodeGuiCommand(new AppBootstrap({ requestId: requestIdFromString("request-1") }));

		expect(command).toBeInstanceOf(AppBootstrap);
		expect(command.requestId).toBe("request-1");
	});

	test("rejects commands with unknown tags", async () => {
		await expect(decodeGuiCommand({ _tag: "unknown.command", requestId: "request-1" })).rejects.toThrow();
	});

	test("rejects commands with missing required payload fields", async () => {
		await expect(decodeGuiCommand({ _tag: "workspace.select", requestId: "request-1" })).rejects.toThrow();
	});

	test("rejects invalid branded IDs", async () => {
		await expect(
			decodeGuiCommand({ _tag: "workspace.select", requestId: "request-1", workspaceId: "" }),
		).rejects.toThrow();
	});

	test("creates branded IDs from valid strings", () => {
		expect(workspaceIdFromString("workspace-1")).toBe("workspace-1");
	});

	test("decodes events", async () => {
		const event = await decodeGuiEvent(
			new ReceiptEmitted({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				receipt: "app.bootstrap.completed",
				requestId: requestIdFromString("request-1"),
			}),
		);

		expect(event).toBeInstanceOf(ReceiptEmitted);
		expect(event.sequence).toBe(1);
	});

	test("decodes error serialization", async () => {
		const error = await decodeGuiError(
			new CommandNotImplemented({
				commandTag: "session.open",
				message: "Command is not implemented in Phase 2",
			}),
		);

		expect(error).toBeInstanceOf(CommandNotImplemented);
		expect(error._tag).toBe("CommandNotImplemented");
	});

	test("exports command, event, and error union schemas", () => {
		expect(GuiCommand).toBeDefined();
		expect(GuiEvent).toBeDefined();
		expect(GuiError).toBeDefined();
		expect(AppReady).toBeDefined();
	});
});
