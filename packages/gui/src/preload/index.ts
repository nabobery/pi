import { contextBridge, ipcRenderer } from "electron";
import { createPiGuiApi, type PiGuiApiTransport } from "./pi-gui-api.ts";

const transport: PiGuiApiTransport = {
	invoke: (channel, command) => ipcRenderer.invoke(channel, command),
	on: (channel, listener) => {
		const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
			listener(value);
		};
		ipcRenderer.on(channel, handler);
		return () => {
			ipcRenderer.removeListener(channel, handler);
		};
	},
};

contextBridge.exposeInMainWorld("piGui", createPiGuiApi(transport));
