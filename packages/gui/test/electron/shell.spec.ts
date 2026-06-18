import { expect, test, _electron as electron } from "@playwright/test";
import { join } from "node:path";
import type { GuiCommand } from "../../src/contracts/index.ts";

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

		const bootstrapCommand = { _tag: "app.bootstrap", requestId: "smoke-1" } as unknown as GuiCommand;
		const bootstrapResultWithReceipts = await page.evaluate(async (command) => {
			const receipts: Array<string> = [];
			const unsubscribe = window.piGui.subscribe((event) => {
				if (event._tag === "receipt.emitted") receipts.push(event.receipt);
			});
			const result = await window.piGui.invoke(command);
			await new Promise((resolve) => setTimeout(resolve, 0));
			unsubscribe();
			return { receipts, result };
		}, bootstrapCommand);
		const bootstrapResult = bootstrapResultWithReceipts.result;
		expect(bootstrapResult.ok).toBe(true);
		if (!bootstrapResult.ok) throw new Error("Expected bootstrap to succeed");
		const bootstrapData = bootstrapResult.data as { appInfo: { name: string; version: string } };
		const appInfo = bootstrapData.appInfo;
		expect(appInfo.name).toBeTruthy();
		expect(appInfo.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(bootstrapResultWithReceipts.receipts).toEqual(["app.bootstrap.accepted", "app.bootstrap.completed"]);

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
			piGuiKeys: ["invoke", "subscribe"],
		});
	} finally {
		await electronApp.close();
	}
});
