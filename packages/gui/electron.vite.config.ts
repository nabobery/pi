import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const isE2eBuild = process.env.PI_GUI_E2E_BUILD === "1";
const codingAgentRuntime = isE2eBuild
	? resolve(import.meta.dirname, "src/main/test-runtime-shim.ts")
	: resolve(import.meta.dirname, "../coding-agent/src/runtime.ts");
const bundledMainDependencies = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-ai/oauth",
	...(isE2eBuild ? ["@earendil-works/pi-coding-agent"] : []),
	"@earendil-works/pi-coding-agent/runtime",
	"@earendil-works/pi-tui",
];

const externalMainDependencies = ["@babel/core", "highlight.js", "jiti"];

export default defineConfig({
	main: {
		resolve: {
			alias: {
				"@earendil-works/pi-agent-core": resolve(import.meta.dirname, "../agent/src/index.ts"),
				"@earendil-works/pi-ai/oauth": resolve(import.meta.dirname, "../ai/src/oauth.ts"),
				"@earendil-works/pi-ai": resolve(import.meta.dirname, "../ai/src/index.ts"),
				"@earendil-works/pi-coding-agent/runtime": codingAgentRuntime,
				"@earendil-works/pi-tui": resolve(import.meta.dirname, "../tui/src/index.ts"),
				"highlight.js/lib/index.js": resolve(import.meta.dirname, "src/main/session/highlight-js-electron.ts"),
			},
		},
		plugins: [externalizeDepsPlugin({ exclude: bundledMainDependencies, include: externalMainDependencies })],
		build: {
			externalizeDeps: {
				exclude: bundledMainDependencies,
				include: externalMainDependencies,
			},
			outDir: "dist/main",
			rollupOptions: {
				external: [/^@babel\/core(?:\/.*)?$/, /^highlight\.js(?:\/.*)?$/, /^jiti(?:\/.*)?$/],
				input: resolve(import.meta.dirname, "src/main/main.ts"),
			},
		},
	},
	preload: {
		ssr: {
			noExternal: true,
		},
		build: {
			outDir: "dist/preload",
			rollupOptions: {
				input: resolve(import.meta.dirname, "src/preload/index.ts"),
				output: {
					entryFileNames: "index.js",
					format: "cjs",
				},
			},
		},
	},
	renderer: {
		root: resolve(import.meta.dirname, "src/renderer"),
		plugins: [react()],
		build: {
			outDir: resolve(import.meta.dirname, "dist/renderer"),
			rollupOptions: {
				input: resolve(import.meta.dirname, "src/renderer/index.html"),
			},
		},
	},
});
