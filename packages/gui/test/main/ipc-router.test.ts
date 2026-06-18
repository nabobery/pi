import { describe, expect, test, vi } from "vitest";
import { AppBootstrap, requestIdFromString } from "../../src/contracts/index.ts";
import { createAppOriginPolicy, getPackagedRendererEntryUrl } from "../../src/main/app-origin-policy.ts";
import { createGuiInvokeHandler, RendererEventBus } from "../../src/main/ipc-router.ts";
import { PI_GUI_EVENT_CHANNEL } from "../../src/shared/contracts.ts";

const app = {
	getName: () => "Pi GUI",
	getVersion: () => "1.2.3",
};

const policy = createAppOriginPolicy({
	packagedRendererUrl: getPackagedRendererEntryUrl("/Applications/Pi.app/Contents/Resources/app.asar/dist/main"),
});

function createSender(id = 1) {
	return {
		id,
		isDestroyed: vi.fn(() => false),
		once: vi.fn(),
		send: vi.fn(),
	};
}

describe("createGuiInvokeHandler", () => {
	test("returns bootstrap data for trusted renderer senders", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(result).toEqual({
			ok: true,
			requestId: "request-1",
			data: {
				appInfo: {
					name: "Pi GUI",
					version: "1.2.3",
					mode: "test",
				},
			},
		});
	});

	test("rejects missing sender frames with renderer-safe errors", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });
		const sender = createSender();

		const result = await handler(
			{ senderFrame: null, sender },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.requestId).toBe("request-1");
			expect(result.error._tag).toBe("UnauthorizedIpcSender");
			expect(result.error.message).toBe("Blocked IPC from missing sender frame");
		}
		expect(sender.send).not.toHaveBeenCalled();
	});

	test("rejects untrusted renderer senders with renderer-safe errors", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });
		const sender = createSender();

		const result = await handler(
			{ senderFrame: { url: "file:///tmp/attacker.html" }, sender },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("UnauthorizedIpcSender");
			expect(result.error.message).toBe("Blocked IPC from untrusted renderer URL: file:///tmp/attacker.html");
		}
		expect(sender.send).not.toHaveBeenCalled();
	});

	test("maps malformed payloads to InvalidRendererCommand", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			{ _tag: "unknown.command", requestId: "request-1" },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.requestId).toBe("request-1");
			expect(result.error._tag).toBe("InvalidRendererCommand");
		}
	});

	test("returns CommandNotImplemented for non-bootstrap commands", async () => {
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		const result = await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender: createSender() },
			{ _tag: "session.open", requestId: "request-1", sessionId: "session-1" },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error._tag).toBe("CommandNotImplemented");
			expect(result.error.message).toBe("session.open is not implemented in Phase 2");
		}
	});

	test("automatically emits bootstrap receipt events to trusted renderer senders", async () => {
		const sender = createSender();
		const eventBus = new RendererEventBus();
		const handler = createGuiInvokeHandler({ app, mode: "test", policy, eventBus });

		await handler(
			{ senderFrame: { url: policy.packagedRendererUrl.href }, sender },
			new AppBootstrap({ requestId: requestIdFromString("request-1") }),
		);

		expect(sender.send).toHaveBeenCalledTimes(2);
		expect(sender.send.mock.calls.map((call) => call[0])).toEqual([PI_GUI_EVENT_CHANNEL, PI_GUI_EVENT_CHANNEL]);
		expect(sender.send.mock.calls.map((call) => call[1])).toEqual([
			expect.objectContaining({ _tag: "receipt.emitted", sequence: 1, receipt: "app.bootstrap.accepted" }),
			expect.objectContaining({ _tag: "receipt.emitted", sequence: 2, receipt: "app.bootstrap.completed" }),
		]);
		expect(sender.once).toHaveBeenCalledWith("destroyed", expect.any(Function));
	});
});

describe("RendererEventBus", () => {
	test("removes senders when web contents are destroyed", () => {
		const eventBus = new RendererEventBus();
		const sender = createSender();

		eventBus.registerSender(sender);
		eventBus.publishReceipt("request-1", "app.bootstrap.accepted");
		const destroyHandler = sender.once.mock.calls[0]?.[1] as (() => void) | undefined;
		destroyHandler?.();
		eventBus.publishReceipt("request-1", "app.bootstrap.completed");

		expect(sender.send).toHaveBeenCalledTimes(1);
	});
});
