import { parseRewriteResponse, parseSuggestionList, parseTranslationResponse } from "../response-parser";

describe("parseRewriteResponse", () => {
	it("splits rewrite and suggestions", () => {
		const raw = ["### NATIVE", "I've gone through the plan.", "", "### SUGGESTIONS", '- Prefer "assumption".', "- Merge clauses."].join("\n");
		const result = parseRewriteResponse(raw);
		expect(result.nativeRewrite).toBe("I've gone through the plan.");
		expect(result.suggestions).toEqual(['Prefer "assumption".', "Merge clauses."]);
		expect(result.raw).toBe(raw);
	});

	it("falls back to the whole text when no markers are present", () => {
		const result = parseRewriteResponse("  Just a rewrite.\r\n");
		expect(result.nativeRewrite).toBe("Just a rewrite.");
		expect(result.suggestions).toEqual([]);
	});

	it("accepts markers in any order, with bold, colons and alternative labels", () => {
		const raw = ["**Suggestions:**", "1. none", "## Native Rewrite", "Natural version.", "Rewrite:", "ignored duplicate"].join("\n");
		const result = parseRewriteResponse(raw);
		expect(result.nativeRewrite).toBe("Natural version.\nignored duplicate");
		expect(result.suggestions).toEqual([]);
	});

	it("strips a wrapping code fence", () => {
		const result = parseRewriteResponse("```markdown\n### NATIVE\nHi there.\n### SUGGESTIONS\n- none\n```");
		expect(result.nativeRewrite).toBe("Hi there.");
	});

	it("uses a DIRECT section or the preamble when NATIVE is missing", () => {
		expect(parseRewriteResponse("### DIRECT\nLiteral.\n### SUGGESTIONS\n- x").nativeRewrite).toBe("Literal.");
		expect(parseRewriteResponse("Before.\n### SUGGESTIONS\n- x").nativeRewrite).toBe("Before.");
	});

	it("does not treat a heading-like line inside a section body as a marker", () => {
		const result = parseRewriteResponse("### NATIVE\n# Chapter 1\nNative\nText.\n### SUGGESTIONS\n- a");
		expect(result.nativeRewrite).toBe("# Chapter 1\nNative\nText.");
	});
});

describe("parseTranslationResponse", () => {
	it("returns plain text as-is, trimmed and unfenced", () => {
		expect(parseTranslationResponse("```\n你好。\n```\n")).toBe("你好。");
	});

	it("extracts the DIRECT section when a model still emits markers", () => {
		expect(parseTranslationResponse("### DIRECT\n你好。\n### NATIVE\nHello.")).toBe("你好。");
		expect(parseTranslationResponse("你好。\n### NATIVE\nHello.")).toBe("你好。");
		expect(parseTranslationResponse("### NATIVE\nHello.")).toBe("Hello.");
	});
});

describe("parseSuggestionList", () => {
	it("strips bullets and numbering and drops placeholders", () => {
		expect(parseSuggestionList("- a\n* b\n• c\n1. d\n2) e\n\nNo suggestions.\nN/A")).toEqual(["a", "b", "c", "d", "e"]);
	});
});
