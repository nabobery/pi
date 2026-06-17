import { describe, expect, test } from "vitest";
import { createMainWindowOptions } from "../../src/main/window-options.ts";

describe("createMainWindowOptions", () => {
	test("returns secure BrowserWindow webPreferences", () => {
		const options = createMainWindowOptions("/tmp/preload.js");

		expect(options.webPreferences).toMatchObject({
			preload: "/tmp/preload.js",
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			webviewTag: false,
			allowRunningInsecureContent: false,
			experimentalFeatures: false,
		});
	});
});
