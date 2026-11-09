import { parseStructuredResponse, parseSuggestionList } from "../response-parser";

describe("parseStructuredResponse", () => {
	it("splits the three sections", () => {
		const raw = [
			"### DIRECT",
			"I read this plan.",
			"",
			"### NATIVE",
			"I've gone through the plan.",
			"",
			"### SUGGESTIONS",
			"- Prefer \"assumption\" over \"premise\".",
			"- Merge the two clauses.",
		].join("\n");
		const result = parseStructuredResponse(raw);
		expect(result.directTranslation).toBe("I read this plan.");
		expect(result.nativePolish).toBe("I've gone through the plan.");
		expect(result.suggestions).toEqual(['Prefer "assumption" over "premise".', "Merge the two clauses."]);
		expect(result.raw).toBe(raw);
	});

	it("falls back to the whole text when no markers are present", () => {
		const result = parseStructuredResponse("  Just a plain translation.\n");
		expect(result.directTranslation).toBe("Just a plain translation.");
		expect(result.nativePolish).toBe("");
		expect(result.suggestions).toEqual([]);
	});

	it("accepts markers in any order, with bold, colons and long labels", () => {
		const raw = [
			"**Suggestions:**",
			"1. none",
			"## Native Polish",
			"Natural version.",
			"Direct translation:",
			"Literal version.",
		].join("\n");
		const result = parseStructuredResponse(raw);
		expect(result.directTranslation).toBe("Literal version.");
		expect(result.nativePolish).toBe("Natural version.");
		expect(result.suggestions).toEqual([]);
	});

	it("strips a wrapping code fence and CRLF line endings", () => {
		const raw = "```markdown\r\n### DIRECT\r\nHello.\r\n### NATIVE\r\nHi there.\r\n### SUGGESTIONS\r\n- none\r\n```";
		const result = parseStructuredResponse(raw);
		expect(result.directTranslation).toBe("Hello.");
		expect(result.nativePolish).toBe("Hi there.");
	});

	it("uses the preamble, then native, when the DIRECT section is missing", () => {
		const withPreamble = parseStructuredResponse("Literal.\n### NATIVE\nNatural.");
		expect(withPreamble.directTranslation).toBe("Literal.");
		const nativeOnly = parseStructuredResponse("### NATIVE\nNatural.\n### SUGGESTIONS\n- tighten it");
		expect(nativeOnly.directTranslation).toBe("Natural.");
		expect(nativeOnly.suggestions).toEqual(["tighten it"]);
	});

	it("does not treat a heading-like line inside a section body as a marker", () => {
		const result = parseStructuredResponse("### DIRECT\n# Chapter 1\nText.\n### NATIVE\nText!");
		expect(result.directTranslation).toBe("# Chapter 1\nText.");
	});
});

describe("parseSuggestionList", () => {
	it("strips bullets and numbering and drops placeholders", () => {
		expect(parseSuggestionList("- a\n* b\n• c\n1. d\n2) e\n\nNo suggestions.\nN/A")).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
	});
});
