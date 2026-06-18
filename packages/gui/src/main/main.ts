import { app, BrowserWindow, session } from "electron";
import { startPiGui } from "./bootstrap.ts";
import { registerContentSecurityPolicy } from "./content-security-policy.ts";
import { registerGuiIpcHandlers } from "./ipc.ts";
import { createMainWindow } from "./window.ts";

void startPiGui({
	app,
	browserWindow: BrowserWindow,
	console,
	createMainWindow,
	devServerUrl: process.env.ELECTRON_RENDERER_URL,
	mainProcessDir: import.meta.dirname,
	mode: process.env.NODE_ENV ?? "production",
	registerGuiIpcHandlers,
	registerContentSecurityPolicy,
	session,
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
