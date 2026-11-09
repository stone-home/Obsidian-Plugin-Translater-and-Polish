import { LANGUAGE_OPTIONS, populateLanguageSelect, resolveLanguage } from "../languages";
import { fillModelSelect, parseModelList, resolveModel } from "../models";

describe("languages", () => {
	it("resolves known codes and falls back", () => {
		expect(resolveLanguage("zh", "en")).toBe("zh");
		expect(resolveLanguage("xx", "en")).toBe("en");
		expect(resolveLanguage(undefined, "nope")).toBe(LANGUAGE_OPTIONS[0]);
	});

	it("populates a select with the current language chosen", () => {
		const select = document.createElement("select");
		populateLanguageSelect(select, "ja");
		expect(select.options.length).toBe(LANGUAGE_OPTIONS.length);
		expect(select.value).toBe("ja");
		populateLanguageSelect(select, "??");
		expect(select.value).toBe("auto");
	});
});

describe("models", () => {
	it("parses, dedupes and falls back", () => {
		expect(parseModelList("a\n\n b \na")).toEqual(["a", "b"]);
		expect(parseModelList("", "custom")).toEqual(["custom"]);
		expect(parseModelList("")).toEqual(["llama3"]);
		expect(resolveModel(["a", "b"], "b")).toBe("b");
		expect(resolveModel(["a", "b"], "zz")).toBe("a");
		expect(resolveModel([], undefined)).toBe("llama3");
	});

	it("fills a select strictly, with a disabled placeholder when empty", () => {
		const select = document.createElement("select");
		expect(fillModelSelect(select, [], "x")).toBe("");
		expect(select.disabled).toBe(true);
		expect(select.options[0].disabled).toBe(true);
		expect(fillModelSelect(select, ["m1", "m2"], "m2")).toBe("m2");
		expect(select.disabled).toBe(false);
		expect(select.value).toBe("m2");
		expect(fillModelSelect(select, ["m1", "m2"], "gone")).toBe("m1");
	});
});
