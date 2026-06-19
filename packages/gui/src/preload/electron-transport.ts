import { PI_GUI_EVENT_CHANNEL, PI_GUI_INVOKE_CHANNEL } from "../shared/contracts.ts";
import type { PiGuiApiTransport } from "./pi-gui-api.ts";

export interface ElectronIpcRenderer {
	invoke(channel: typeof PI_GUI_INVOKE_CHANNEL, command: unknown): Promise<unknown>;
	on(channel: typeof PI_GUI_EVENT_CHANNEL, listener: (event: unknown, value: unknown) => void): void;
	removeListener(channel: typeof PI_GUI_EVENT_CHANNEL, listener: (event: unknown, value: unknown) => void): void;
}

export function createPiGuiElectronTransport(ipcRenderer: ElectronIpcRenderer): PiGuiApiTransport {
	return {
		invoke: (channel, command) => ipcRenderer.invoke(channel, command),
		on: (channel, listener) => {
			const handler = (_event: unknown, value: unknown) => {
				listener(value);
			};
			ipcRenderer.on(channel, handler);
			return () => {
				ipcRenderer.removeListener(channel, handler);
			};
		},
	};
}
