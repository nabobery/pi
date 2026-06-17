import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");

describe("process boundaries", () => {
	test("renderer and preload do not import from main process modules", () => {
		const files = ["src/renderer/app/App.tsx", "src/preload/pi-gui-api.ts"].map((file) =>
			readFileSync(resolve(packageRoot, file), "utf8"),
		);

		for (const file of files) {
			expect(file).not.toContain("/main/");
			expect(file).not.toContain("../main/");
			expect(file).not.toContain("../../main/");
		}
	});
});
