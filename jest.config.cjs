/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: "jsdom",
	roots: ["<rootDir>/src"],
	testMatch: ["**/__tests__/**/*.test.ts"],
	setupFilesAfterEnv: ["<rootDir>/test/setup-dom.ts"],
	transform: {
		"^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs", types: ["jest", "node"] } }],
	},
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/test/obsidian-stub.ts",
	},
	collectCoverageFrom: ["src/**/*.ts", "!src/__tests__/**"],
	coverageThreshold: {
		global: { statements: 85, branches: 75, functions: 85, lines: 85 },
	},
};
