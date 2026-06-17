import { describe, expect, test, vi } from "vitest";
import { createPiGuiApi } from "../../src/preload/pi-gui-api.ts";

describe("createPiGuiApi", () => {
	test("exposes only getAppInfo", async () => {
		const invoke = vi.fn().mockResolvedValue({
			name: "Pi GUI",
			version: "1.2.3",
			mode: "test",
		});

		const api = createPiGuiApi(invoke);

		expect(Object.keys(api)).toEqual(["getAppInfo"]);
		await expect(api.getAppInfo()).resolves.toEqual({
			name: "Pi GUI",
			version: "1.2.3",
			mode: "test",
		});
		expect(invoke).toHaveBeenCalledWith("app:get-info");
	});
});
