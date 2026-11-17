/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: "jsdom",
	roots: ["<rootDir>/src", "<rootDir>/tests"],
	testMatch: ["<rootDir>/tests/**/*.test.ts"],
	setupFilesAfterEnv: ["<rootDir>/tests/helpers/setup-dom.ts"],
	transform: {
		"^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs", types: ["jest", "node"] } }],
	},
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/tests/helpers/obsidian-stub.ts",
	},
	collectCoverageFrom: ["src/**/*.ts"],
	coverageThreshold: {
		global: { statements: 85, branches: 75, functions: 85, lines: 85 },
	},
};
