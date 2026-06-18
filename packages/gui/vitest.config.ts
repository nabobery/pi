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
		include: ["test/**/*.test.ts"],
		environment: "node",
		watch: false,
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: ["src/**/*.d.ts"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 70,
				statements: 80,
			},
		},
	},
});
