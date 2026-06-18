import { defineConfig } from "oxlint";

export default defineConfig({
	plugins: ["react", "react-hooks", "typescript", "oxc"],
	categories: {
		correctness: "error",
		suspicious: "error",
		perf: "warn",
	},
	rules: {
		"no-underscore-dangle": "off",
		"react/react-in-jsx-scope": "off",
		"typescript/no-explicit-any": "error",
	},
	ignorePatterns: ["dist/**", "dist-types/**", "node_modules/**"],
});
