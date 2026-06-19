import { describe, expect, test, vi } from "vitest";
import { AppBootstrap, requestIdFromString } from "../../src/contracts/index.ts";
import { createPiGuiElectronTransport } from "../../src/preload/electron-transport.ts";
import { PI_GUI_EVENT_CHANNEL, PI_GUI_INVOKE_CHANNEL } from "../../src/shared/contracts.ts";

describe("createPiGuiElectronTransport", () => {
	test("uses fixed channels and drops raw Electron event objects", async () => {
		const ipcRenderer = {
			invoke: vi.fn().mockResolvedValue({ ok: true, requestId: "request-1", data: {} }),
			on: vi.fn(),
			removeListener: vi.fn(),
		};
		const transport = createPiGuiElectronTransport(ipcRenderer);
		const listener = vi.fn();
		const rawEvent = { sender: "main" };
		const payload = { _tag: "receipt.emitted", receipt: "ok" };
		const command = new AppBootstrap({ requestId: requestIdFromString("request-1") });

		await expect(transport.invoke(PI_GUI_INVOKE_CHANNEL, command)).resolves.toEqual({
			ok: true,
			requestId: "request-1",
			data: {},
		});
		const unsubscribe = transport.on(PI_GUI_EVENT_CHANNEL, listener);
		const handler = ipcRenderer.on.mock.calls[0]?.[1];
		if (typeof handler !== "function") throw new Error("Expected IPC listener");
		handler(rawEvent, payload);
		unsubscribe();

		expect(ipcRenderer.invoke).toHaveBeenCalledWith(PI_GUI_INVOKE_CHANNEL, command);
		expect(ipcRenderer.on).toHaveBeenCalledWith(PI_GUI_EVENT_CHANNEL, expect.any(Function));
		expect(listener).toHaveBeenCalledWith(payload);
		expect(listener).not.toHaveBeenCalledWith(rawEvent);
		expect(ipcRenderer.removeListener).toHaveBeenCalledWith(PI_GUI_EVENT_CHANNEL, handler);
	});
});
