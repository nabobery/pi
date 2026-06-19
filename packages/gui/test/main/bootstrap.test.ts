import { describe, expect, test, vi } from "vitest";
import { startPiGui } from "../../src/main/bootstrap.ts";

describe("startPiGui", () => {
	test("registers startup security controls and creates the first window", async () => {
		const on = vi.fn();
		const setPermissionRequestHandler = vi.fn();
		const registerContentSecurityPolicy = vi.fn();
		const registerGuiIpcHandlers = vi.fn();
		const createMainWindow = vi.fn();

		await startPiGui({
			app: {
				exit: vi.fn(),
				getName: () => "Pi GUI",
				getVersion: () => "1.2.3",
				on,
				whenReady: vi.fn().mockResolvedValue(undefined),
			},
			browserWindow: {
				getAllWindows: () => [],
			},
			console: { error: vi.fn() },
			createMainWindow,
			devServerUrl: "http://localhost:5173",
			mainProcessDir: "/Applications/Pi.app/Contents/Resources/app.asar/dist/main",
			mode: "test",
			registerGuiIpcHandlers,
			registerContentSecurityPolicy,
			session: {
				defaultSession: {
					setPermissionRequestHandler,
					webRequest: {
						onHeadersReceived: vi.fn(),
					},
				},
			},
		});

		expect(setPermissionRequestHandler).toHaveBeenCalledOnce();
		const permissionHandler = setPermissionRequestHandler.mock.calls[0]?.[0];
		const permissionCallback = vi.fn();
		permissionHandler?.(undefined, "media", permissionCallback);
		expect(permissionCallback).toHaveBeenCalledWith(false);
		expect(registerContentSecurityPolicy).toHaveBeenCalledWith(expect.any(Object), true);
		expect(registerGuiIpcHandlers).toHaveBeenCalledOnce();
		expect(createMainWindow).toHaveBeenCalledOnce();

		const activateHandler = on.mock.calls.find(([event]) => event === "activate")?.[1];
		activateHandler?.();
		expect(createMainWindow).toHaveBeenCalledTimes(2);
	});

	test("logs and exits through the guarded startup path for invalid renderer URLs", async () => {
		const error = vi.fn();
		const exit = vi.fn();
		const whenReady = vi.fn().mockResolvedValue(undefined);

		await startPiGui({
			app: {
				exit,
				getName: () => "Pi GUI",
				getVersion: () => "1.2.3",
				on: vi.fn(),
				whenReady,
			},
			browserWindow: {
				getAllWindows: () => [],
			},
			console: { error },
			createMainWindow: vi.fn(),
			devServerUrl: "https://example.com",
			mainProcessDir: "/Applications/Pi.app/Contents/Resources/app.asar/dist/main",
			mode: "test",
			registerGuiIpcHandlers: vi.fn(),
			registerContentSecurityPolicy: vi.fn(),
			session: {
				defaultSession: {
					setPermissionRequestHandler: vi.fn(),
					webRequest: {
						onHeadersReceived: vi.fn(),
					},
				},
			},
		});

		expect(whenReady).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith("Failed to start Pi GUI", expect.any(Error));
		expect(exit).toHaveBeenCalledWith(1);
	});
});
