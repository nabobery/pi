import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RootTsConfig {
	compilerOptions: Record<string, unknown>;
	exclude: string[];
}

const rootTsConfig = JSON.parse(
	readFileSync(resolve(import.meta.dirname, "../../..", "tsconfig.json"), "utf8"),
) as RootTsConfig;

describe("root TypeScript scope", () => {
	test("does not add DOM or JSX globals to every package", () => {
		expect(rootTsConfig.compilerOptions).not.toHaveProperty("jsx");
		expect(rootTsConfig.compilerOptions).not.toHaveProperty("lib");
	});

	test("leaves GUI DOM and JSX typechecking to the GUI package", () => {
		expect(rootTsConfig.exclude).toContain("packages/gui/**");
	});
});
