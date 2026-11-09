/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: "node",
	roots: ["<rootDir>/src"],
	testMatch: ["**/__tests__/**/*.test.ts"],
	transform: {
		"^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
	},
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/test/obsidian-stub.ts",
	},
};
