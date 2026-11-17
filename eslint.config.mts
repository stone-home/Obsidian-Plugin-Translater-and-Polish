import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
	globalIgnores([
		"node_modules",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"jest.config.cjs",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"coverage",
		".skills-hub",
		"playground",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				project: "./tsconfig.eslint.json",
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Request tracing is a user-facing feature behind the Debug setting; the only console call lives here.
		files: ["src/translation-backend.ts"],
		rules: { "obsidianmd/rule-custom-message": "off" },
	},
	{
		files: ["tests/**/*.ts"],
		languageOptions: { globals: { ...globals.jest, ...globals.node } },
	},
);
