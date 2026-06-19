import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@earendil-works/pi-agent-core": resolve(import.meta.dirname, "../agent/src/index.ts"),
			"@earendil-works/pi-ai/oauth": resolve(import.meta.dirname, "../ai/src/oauth.ts"),
			"@earendil-works/pi-ai": resolve(import.meta.dirname, "../ai/src/index.ts"),
			"@earendil-works/pi-coding-agent/runtime": resolve(import.meta.dirname, "../coding-agent/src/runtime.ts"),
			"@earendil-works/pi-tui": resolve(import.meta.dirname, "../tui/src/index.ts"),
		},
	},
	test: {
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		environment: "node",
		watch: false,
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: [
				"src/**/*.d.ts",
				// Entrypoint wrappers are covered through Electron E2E and lower-level module tests.
				"src/main/main.ts",
				"src/preload/index.ts",
				"src/renderer/main.tsx",
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80,
			},
		},
	},
});
