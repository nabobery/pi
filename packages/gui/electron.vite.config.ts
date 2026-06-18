import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		resolve: {
			alias: {
				"@earendil-works/pi-agent-core": resolve(import.meta.dirname, "../agent/src/index.ts"),
				"@earendil-works/pi-ai": resolve(import.meta.dirname, "../ai/src/index.ts"),
			},
		},
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "dist/main",
			rollupOptions: {
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
