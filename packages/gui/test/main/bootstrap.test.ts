import { describe, expect, test, vi } from "vitest";
import { startPiGui } from "../../src/main/bootstrap.ts";

describe("startPiGui", () => {
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
			registerAppInfoHandler: vi.fn(),
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
