import { contextBridge, ipcRenderer } from "electron";
import { createPiGuiApi, type AppInfoInvoker } from "./pi-gui-api.ts";

const invokeAppInfo: AppInfoInvoker = (channel) => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld("piGui", createPiGuiApi(invokeAppInfo));
