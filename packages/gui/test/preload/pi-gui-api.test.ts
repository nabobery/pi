import { describe, expect, test, vi } from "vitest";
import { AppBootstrap, ReceiptEmitted, eventIdFromString, requestIdFromString } from "../../src/contracts/index.ts";
import { createPiGuiApi } from "../../src/preload/pi-gui-api.ts";

describe("createPiGuiApi", () => {
	test("exposes only invoke and subscribe", async () => {
		const invoke = vi.fn().mockResolvedValue({
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
		const on = vi.fn().mockReturnValue(() => undefined);

		const api = createPiGuiApi({ invoke, on });

		expect(Object.keys(api)).toEqual(["invoke", "subscribe"]);
		const command = new AppBootstrap({ requestId: requestIdFromString("request-1") });

		await expect(api.invoke(command)).resolves.toEqual({
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
		expect(invoke).toHaveBeenCalledWith("pi-gui:invoke", command);
	});

	test("subscribes to the fixed event channel", () => {
		const unsubscribe = vi.fn();
		const invoke = vi.fn();
		const on = vi.fn().mockReturnValue(unsubscribe);
		const listener = vi.fn();

		const api = createPiGuiApi({ invoke, on });
		const cleanup = api.subscribe(listener);

		expect(on).toHaveBeenCalledWith("pi-gui:event", expect.any(Function));
		cleanup();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	test("forwards event payloads to subscribers", () => {
		let eventListener: ((event: unknown) => void) | undefined;
		const invoke = vi.fn();
		const on = vi.fn((_channel, listener: (event: unknown) => void) => {
			eventListener = listener;
			return () => undefined;
		});
		const listener = vi.fn();

		const api = createPiGuiApi({ invoke, on });
		api.subscribe(listener);

		const event = { _tag: "receipt.emitted", eventId: "", sequence: 1, receipt: "bad", requestId: "request-1" };
		eventListener?.(event);

		expect(listener).toHaveBeenCalledWith(event);
	});

	test("delivers valid event payloads unchanged", () => {
		let eventListener: ((event: unknown) => void) | undefined;
		const invoke = vi.fn();
		const on = vi.fn((_channel, listener: (event: unknown) => void) => {
			eventListener = listener;
			return () => undefined;
		});
		const listener = vi.fn();

		const api = createPiGuiApi({ invoke, on });
		api.subscribe(listener);

		const event = new ReceiptEmitted({
			eventId: eventIdFromString("event-1"),
			sequence: 1,
			receipt: "app.bootstrap.completed",
			requestId: requestIdFromString("request-1"),
		});
		eventListener?.(event);

		expect(listener).toHaveBeenCalledWith(event);
	});

	test("returns invoke results unchanged", async () => {
		const invoke = vi.fn().mockResolvedValue({ ok: true, requestId: "", data: {} });
		const on = vi.fn();
		const api = createPiGuiApi({ invoke, on });

		const result = await api.invoke(new AppBootstrap({ requestId: requestIdFromString("request-1") }));

		expect(result).toEqual({ ok: true, requestId: "", data: {} });
	});
});
