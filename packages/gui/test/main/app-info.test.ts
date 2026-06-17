import { describe, expect, test } from "vitest";
import { createAppInfo } from "../../src/main/app-info.ts";

describe("createAppInfo", () => {
	test("returns stable app metadata for the renderer", () => {
		const appInfo = createAppInfo(
			{
				getName: () => "Pi GUI",
				getVersion: () => "1.2.3",
			},
			"test",
		);

		expect(appInfo).toEqual({
			name: "Pi GUI",
			version: "1.2.3",
			mode: "test",
		});
	});
});
