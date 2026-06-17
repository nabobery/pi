import { expect, test, _electron as electron } from "@playwright/test";
import { join } from "node:path";

test("launches the secure Pi GUI shell", async () => {
	const electronApp = await electron.launch({
		args: [join(import.meta.dirname, "../..")],
		env: {
			...process.env,
			NODE_ENV: "test",
		},
	});

	try {
		const page = await electronApp.firstWindow();
		await page.waitForURL((url) => url.protocol === "file:" || url.origin === "http://localhost:5173");
		await page.waitForLoadState("domcontentloaded");

		expect(page.url()).toMatch(/^(file:\/\/.*\/dist\/renderer\/index\.html|http:\/\/localhost:5173\/)/);
		await expect(page.getByRole("heading", { name: "Pi" })).toBeVisible();
		await expect(page.getByTestId("composer-input")).toBeVisible();

		const appInfo = await page.evaluate(() => window.piGui.getAppInfo());
		expect(appInfo.name).toBeTruthy();
		expect(appInfo.version).toMatch(/^\d+\.\d+\.\d+/);

		const rendererGlobals = await page.evaluate(() => ({
			hasPiGui: "piGui" in window,
			hasProcess: "process" in window,
			hasRequire: "require" in window,
			hasIpcRenderer: "ipcRenderer" in window,
			hasElectronAPI: "electronAPI" in window,
			piGuiKeys: Object.keys(window.piGui),
		}));

		expect(rendererGlobals).toEqual({
			hasPiGui: true,
			hasProcess: false,
			hasRequire: false,
			hasIpcRenderer: false,
			hasElectronAPI: false,
			piGuiKeys: ["getAppInfo"],
		});
	} finally {
		await electronApp.close();
	}
});
