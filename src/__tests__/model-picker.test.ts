import { freshDefaultSettings } from "../defaults";
import { decodeBinding, encodeBinding, fillTaskModelSelect } from "../model-picker";

describe("model picker", () => {
	it("round-trips bindings and rejects junk", () => {
		expect(decodeBinding(encodeBinding({ provider: "openrouter", model: "a::b/c" }))).toEqual({ provider: "openrouter", model: "a::b/c" });
		expect(decodeBinding("nope::m")).toBeUndefined();
		expect(decodeBinding("ollama::")).toBeUndefined();
		expect(decodeBinding("garbage")).toBeUndefined();
	});

	it("groups models by provider, keeps an unlisted current model, and handles empty lists", () => {
		const settings = freshDefaultSettings();
		settings.providers.openrouter.models = ["x/y"];
		const select = document.createElement("select");
		expect(fillTaskModelSelect(select, settings, { provider: "openrouter", model: "x/y" })).toBe(true);
		expect(select.querySelectorAll("optgroup")).toHaveLength(2);
		expect(select.value).toBe("openrouter::x/y");

		expect(fillTaskModelSelect(select, settings, { provider: "openwebui", model: "ghost" })).toBe(true);
		expect(select.value).toBe("openwebui::ghost");
		expect(select.selectedOptions[0].textContent).toContain("not in fetched list");

		settings.providers.ollama.models = [];
		settings.providers.openrouter.models = [];
		expect(fillTaskModelSelect(select, settings, { provider: "ollama", model: "" })).toBe(false);
		expect(select.disabled).toBe(true);
	});
});
