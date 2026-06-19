import { describe, expect, test, vi } from "vitest";
import { createAppOriginPolicy, getPackagedRendererEntryUrl } from "../../src/main/app-origin-policy.ts";
import { createMainWindow } from "../../src/main/window.ts";

const mocks = vi.hoisted(() => ({
	browserWindows: [] as MockBrowserWindow[],
}));

vi.mock("electron", () => ({
	BrowserWindow: function MockedBrowserWindow(options: unknown) {
		const window = new MockBrowserWindow(options);
		mocks.browserWindows.push(window);
		return window;
	},
}));

describe("createMainWindow", () => {
	test("loads packaged files and shows on ready-to-show", () => {
		const policy = createAppOriginPolicy({
			packagedRendererUrl: getPackagedRendererEntryUrl("/Applications/Pi.app/Contents/Resources/app.asar/dist/main"),
		});

		const window = createMainWindow({
			appOriginPolicy: policy,
			rendererTarget: {
				kind: "file",
				path: "/Applications/Pi.app/Contents/Resources/app.asar/dist/renderer/index.html",
			},
		});

		expect(window).toBe(mocks.browserWindows[0]);
		expect(mocks.browserWindows[0]?.loadFile).toHaveBeenCalledWith(
			"/Applications/Pi.app/Contents/Resources/app.asar/dist/renderer/index.html",
		);
		mocks.browserWindows[0]?.emitReadyToShow();
		expect(mocks.browserWindows[0]?.show).toHaveBeenCalledOnce();
	});

	test("loads dev URLs and blocks disallowed navigation and popups", () => {
		const policy = createAppOriginPolicy({
			devServerUrl: "http://localhost:5173",
			packagedRendererUrl: getPackagedRendererEntryUrl("/Applications/Pi.app/Contents/Resources/app.asar/dist/main"),
		});

		createMainWindow({
			appOriginPolicy: policy,
			rendererTarget: { kind: "url", url: "http://localhost:5173" },
		});
		const window = mocks.browserWindows.at(-1);
		expect(window?.loadURL).toHaveBeenCalledWith("http://localhost:5173");

		const allowedEvent = { preventDefault: vi.fn() };
		window?.emitWillNavigate(allowedEvent, "http://localhost:5173/src/renderer/main.tsx");
		expect(allowedEvent.preventDefault).not.toHaveBeenCalled();

		const blockedEvent = { preventDefault: vi.fn() };
		window?.emitWillNavigate(blockedEvent, "https://example.com");
		expect(blockedEvent.preventDefault).toHaveBeenCalledOnce();
		expect(window?.openHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
	});
});

class MockBrowserWindow {
	readonly options: unknown;
	readonly loadFile = vi.fn().mockResolvedValue(undefined);
	readonly loadURL = vi.fn().mockResolvedValue(undefined);
	readonly show = vi.fn();
	readonly webContents = {
		on: vi.fn((event: string, handler: (event: { preventDefault(): void }, url: string) => void) => {
			if (event === "will-navigate") this.navigateHandler = handler;
		}),
		setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: "deny" }) => {
			this.openHandler = handler;
		}),
	};
	private readyToShowHandler: (() => void) | undefined;
	private navigateHandler: ((event: { preventDefault(): void }, url: string) => void) | undefined;
	openHandler: ((details: { url: string }) => { action: "deny" }) | undefined;

	constructor(options: unknown) {
		this.options = options;
	}

	once(event: string, handler: () => void): void {
		if (event === "ready-to-show") this.readyToShowHandler = handler;
	}

	emitReadyToShow(): void {
		this.readyToShowHandler?.();
	}

	emitWillNavigate(event: { preventDefault(): void }, url: string): void {
		this.navigateHandler?.(event, url);
	}
}
