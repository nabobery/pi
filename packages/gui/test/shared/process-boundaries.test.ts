import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");

describe("process boundaries", () => {
	test("renderer stays behind the typed client boundary", () => {
		for (const file of readSourceFiles("src/renderer")) {
			expect(file).not.toMatch(fromModule("electron"));
			expect(file).not.toMatch(fromModule("node:"));
			expect(file).not.toContain("/main/");
			expect(file).not.toContain("../main/");
			expect(file).not.toContain("../../main/");
			expect(file).not.toContain("@earendil-works/pi-coding-agent");
		}
	});

	test("preload stays narrow and does not import runtime or app modules", () => {
		for (const file of readSourceFiles("src/preload")) {
			expect(file).not.toContain("/main/");
			expect(file).not.toContain("../main/");
			expect(file).not.toContain("../../main/");
			expect(file).not.toContain("/renderer/");
			expect(file).not.toContain("../renderer/");
			expect(file).not.toContain("../../renderer/");
			expect(file).not.toContain("@earendil-works/pi-coding-agent");
		}
	});

	test("main process does not import renderer modules", () => {
		for (const file of readSourceFiles("src/main")) {
			expect(file).not.toMatch(/from\s+["'][^"']*\/renderer\//);
			expect(file).not.toMatch(/from\s+["']\.\.\/renderer\//);
			expect(file).not.toMatch(/from\s+["']\.\.\/\.\.\/renderer\//);
		}
	});

	test("contracts are process-neutral", () => {
		for (const file of readSourceFiles("src/contracts")) {
			expect(file).not.toMatch(fromModule("electron"));
			expect(file).not.toMatch(fromModule("node:"));
			expect(file).not.toContain("/main/");
			expect(file).not.toContain("../main/");
			expect(file).not.toContain("../../main/");
			expect(file).not.toContain("/preload/");
			expect(file).not.toContain("../preload/");
			expect(file).not.toContain("../../preload/");
			expect(file).not.toContain("/renderer/");
			expect(file).not.toContain("../renderer/");
			expect(file).not.toContain("../../renderer/");
			expect(file).not.toContain("@earendil-works/pi-coding-agent");
		}
	});
});

function readSourceFiles(directory: string): string[] {
	return listSourceFiles(resolve(packageRoot, directory))
		.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
		.map((file) => readFileSync(file, "utf8"));
}

function fromModule(moduleName: string): RegExp {
	return new RegExp(`from\\s+["']${escapeRegExp(moduleName)}`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
