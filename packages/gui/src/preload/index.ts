import { contextBridge, ipcRenderer } from "electron";
import { createPiGuiElectronTransport } from "./electron-transport.ts";
import { createPiGuiApi } from "./pi-gui-api.ts";

contextBridge.exposeInMainWorld("piGui", createPiGuiApi(createPiGuiElectronTransport(ipcRenderer)));
