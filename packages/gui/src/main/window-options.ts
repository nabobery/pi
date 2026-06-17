import type { BrowserWindowConstructorOptions } from "electron";

export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
	return {
		width: 1180,
		height: 760,
		minWidth: 900,
		minHeight: 620,
		title: "Pi",
		backgroundColor: "#f7f7f4",
		show: false,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			webviewTag: false,
			allowRunningInsecureContent: false,
			experimentalFeatures: false,
		},
	};
}
