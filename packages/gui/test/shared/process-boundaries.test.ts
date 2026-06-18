import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");

describe("process boundaries", () => {
	test("renderer and preload do not import from main process modules", () => {
		const files = [
			...listSourceFiles(resolve(packageRoot, "src/renderer")),
			...listSourceFiles(resolve(packageRoot, "src/preload")),
		]
			.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
			.map((file) => readFileSync(file, "utf8"));

		for (const file of files) {
			expect(file).not.toContain("/main/");
			expect(file).not.toContain("../main/");
			expect(file).not.toContain("../../main/");
			expect(file).not.toContain("@earendil-works/pi-coding-agent");
		}
	});
});

function listSourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory)) {
		const path = resolve(directory, entry);
		if (statSync(path).isDirectory()) {
			files.push(...listSourceFiles(path));
			continue;
		}
		files.push(path);
	}
	return files;
}
