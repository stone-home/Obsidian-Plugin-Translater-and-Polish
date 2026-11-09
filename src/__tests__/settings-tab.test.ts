import { Notice } from "obsidian";
import { flush, makePlugin } from "../../test/helpers";
import { TranslatePolishSettingTab } from "../settings";
import type TranslatePolishPlugin from "../main";

function fire(el: HTMLElement, type: string): void {
	el.dispatchEvent(new Event(type, { bubbles: true }));
}

function settingsNamed(root: HTMLElement, name: string): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(".setting-item")).filter(
		(item) => item.querySelector(".setting-item-name")?.textContent === name,
	);
}

function settingByName(root: HTMLElement, name: string, index = 0): HTMLElement {
	const hit = settingsNamed(root, name)[index];
	if (!hit) throw new Error(`setting ${name}[${index}] not found`);
	return hit;
}

describe("TranslatePolishSettingTab", () => {
	let plugin: TranslatePolishPlugin;
	let tab: TranslatePolishSettingTab;

	beforeEach(async () => {
		plugin = await makePlugin();
		tab = new TranslatePolishSettingTab(plugin.app, plugin);
		tab.display();
	});
	afterEach(() => {
		document.body.innerHTML = "";
		Notice.all = [];
	});

	it("renders headings, task pickers and provider blocks", () => {
		const headings = Array.from(tab.containerEl.querySelectorAll(".setting-item-heading .setting-item-name")).map((e) => e.textContent);
		expect(headings).toEqual(["Models", "Ollama", "OpenRouter", "Open WebUI", "Translation", "Advanced"]);
		expect(settingsNamed(tab.containerEl, "Translation model")).toHaveLength(1);
		expect(settingsNamed(tab.containerEl, "Native rewrite model")).toHaveLength(1);
		// Ollama has no API key field; OpenRouter has no base URL field.
		expect(tab.containerEl.querySelectorAll('input[type="password"]')).toHaveLength(2);
		expect(settingsNamed(tab.containerEl, "Base URL")).toHaveLength(2);
		expect(settingsNamed(tab.containerEl, "Available models")).toHaveLength(3);
		expect(settingByName(tab.containerEl, "Available models", 0).textContent).toContain("1 model available");
		expect(settingByName(tab.containerEl, "Available models", 1).textContent).toContain("No models fetched yet");
	});

	it("binds tasks to provider models", async () => {
		plugin.settings.providers.openrouter.models = ["a/b"];
		tab.display();
		const select = settingByName(tab.containerEl, "Native rewrite model").querySelector("select")!;
		expect(select.querySelectorAll("optgroup")).toHaveLength(2);
		select.value = "openrouter::a/b";
		fire(select, "change");
		await flush();
		expect(plugin.settings.tasks.rewrite).toEqual({ provider: "openrouter", model: "a/b" });
		expect(plugin.settings.tasks.translate).toEqual({ provider: "ollama", model: "llama3" });
	});

	it("edits base URLs", async () => {
		const baseUrl = settingByName(tab.containerEl, "Base URL", 0).querySelector("input")!;
		baseUrl.value = "http://ollama.local:11434/";
		fire(baseUrl, "input");
		await flush();
		expect(plugin.settings.providers.ollama.baseUrl).toBe("http://ollama.local:11434");
		baseUrl.value = "   ";
		fire(baseUrl, "input");
		await flush();
		expect(plugin.settings.providers.ollama.baseUrl).toBe("http://localhost:13434");
	});

	it("stores API keys after a debounce or on blur", async () => {
		jest.useFakeTimers();
		const key = settingByName(tab.containerEl, "API key", 0).querySelector("input")!;
		key.value = " sk-abc ";
		fire(key, "input");
		expect(plugin.getApiKey("openrouter")).toBe("");
		jest.advanceTimersByTime(500);
		expect(plugin.getApiKey("openrouter")).toBe("sk-abc");
		key.value = "sk-def";
		fire(key, "input");
		fire(key, "blur");
		expect(plugin.getApiKey("openrouter")).toBe("sk-def");
		fire(key, "blur");
		jest.useRealTimers();
	});

	it("fetches models, refreshes the task pickers and reports failures", async () => {
		const list = jest.spyOn(plugin.getBackend(), "listModels").mockResolvedValue(["m2", "m1"]);
		const setting = settingByName(tab.containerEl, "Available models", 1);
		const button = setting.querySelector("button")!;
		button.click();
		expect(button.disabled).toBe(true);
		await flush();
		expect(setting.textContent).toContain("2 models available");
		expect(Notice.all[0].message).toBe("Fetched 2 models from OpenRouter.");
		expect(button.disabled).toBe(false);
		const picker = settingByName(tab.containerEl, "Translation model").querySelector("select")!;
		expect(Array.from(picker.options).map((o) => o.value)).toEqual(["ollama::llama3", "openrouter::m2", "openrouter::m1"]);

		list.mockRejectedValue(new Error("HTTP 401"));
		button.click();
		await flush();
		expect(Notice.all[1].message).toContain("Could not fetch models from OpenRouter: HTTP 401");

		list.mockResolvedValue(["only"]);
		settingByName(tab.containerEl, "Available models", 0).querySelector("button")!.click();
		await flush();
		expect(Notice.all[2].message).toBe("Fetched 1 model from Ollama.");
	});

	it("edits languages, prompts, numbers, headers and debug", async () => {
		const source = settingByName(tab.containerEl, "Default source language").querySelector("select")!;
		source.value = "ja";
		fire(source, "change");
		const target = settingByName(tab.containerEl, "Default target language").querySelector("select")!;
		target.value = "de";
		fire(target, "change");
		await flush();
		expect(plugin.settings.defaultSourceLang).toBe("ja");
		expect(plugin.settings.defaultTargetLang).toBe("de");

		const prompt = settingByName(tab.containerEl, "Translation prompt").querySelector("textarea")!;
		prompt.value = "  Custom {{targetLang}}  ";
		fire(prompt, "input");
		await flush();
		expect(plugin.settings.translatePrompt).toBe("Custom {{targetLang}}");
		prompt.value = "";
		fire(prompt, "input");
		await flush();
		expect(plugin.settings.translatePrompt).toContain("professional translator");

		const rewritePrompt = settingByName(tab.containerEl, "Rewrite prompt").querySelector("textarea")!;
		rewritePrompt.value = "Rewrite please";
		fire(rewritePrompt, "input");
		await flush();
		expect(plugin.settings.rewritePrompt).toBe("Rewrite please");
		rewritePrompt.value = " ";
		fire(rewritePrompt, "input");
		await flush();
		expect(plugin.settings.rewritePrompt).toContain("writing coach");

		const delay = settingByName(tab.containerEl, "Live translate delay (ms)").querySelector("input")!;
		delay.value = "1200.7";
		fire(delay, "input");
		await flush();
		expect(plugin.settings.liveDelayMs).toBe(1200);
		delay.value = "-3";
		fire(delay, "input");
		await flush();
		expect(plugin.settings.liveDelayMs).toBe(800);
		const timeout = settingByName(tab.containerEl, "Request timeout (ms)").querySelector("input")!;
		timeout.value = "abc";
		fire(timeout, "input");
		await flush();
		expect(plugin.settings.timeoutMs).toBe(20000);

		const headers = settingByName(tab.containerEl, "Extra headers (Open WebUI)").querySelector("textarea")!;
		headers.value = "X-A: 1";
		fire(headers, "input");
		await flush();
		expect(plugin.settings.providers.openwebui.extraHeadersRaw).toBe("X-A: 1");

		settingByName(tab.containerEl, "Debug").querySelector<HTMLElement>(".checkbox-container")!.click();
		await flush();
		expect(plugin.settings.debug).toBe(true);
	});
});
