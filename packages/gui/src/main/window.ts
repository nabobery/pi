import { BrowserWindow } from "electron";
import { join } from "node:path";
import type { AppOriginPolicy, RendererTarget } from "./app-origin-policy.ts";
import { isAllowedAppUrl } from "./app-origin-policy.ts";
import { createMainWindowOptions } from "./window-options.ts";

export function createMainWindow(options: {
	appOriginPolicy: AppOriginPolicy;
	rendererTarget: RendererTarget;
}): BrowserWindow {
	const preloadPath = join(import.meta.dirname, "../preload/index.js");
	const mainWindow = new BrowserWindow(createMainWindowOptions(preloadPath));

	mainWindow.once("ready-to-show", () => {
		mainWindow.show();
	});

	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!isAllowedAppUrl(options.appOriginPolicy, url)) {
			event.preventDefault();
		}
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void url;
		return { action: "deny" };
	});

	if (options.rendererTarget.kind === "url") {
		void mainWindow.loadURL(options.rendererTarget.url);
	} else {
		void mainWindow.loadFile(options.rendererTarget.path);
	}

	return mainWindow;
}
