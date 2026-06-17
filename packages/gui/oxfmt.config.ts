import { defineConfig } from "oxfmt";

export default defineConfig({
	useTabs: true,
	tabWidth: 3,
	printWidth: 120,
	semi: true,
	trailingComma: "all",
	sortPackageJson: true,
	ignorePatterns: ["dist/**", "dist-types/**", "node_modules/**"],
});
