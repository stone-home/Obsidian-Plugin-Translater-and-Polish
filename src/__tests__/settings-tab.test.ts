/* eslint-disable @typescript-eslint/no-explicit-any */
import { Notice, Setting } from "obsidian";
import { flush, makePlugin } from "../../test/helpers";
import { TranslateBlockSettingTab, populateModelDropdown } from "../settings";
import type TranslateBlockPlugin from "../main";

function fire(el: HTMLElement, type: string): void {
	el.dispatchEvent(new Event(type, { bubbles: true }));
}

function settingByName(root: HTMLElement, name: string): HTMLElement {
	const items = Array.from(root.querySelectorAll<HTMLElement>(".setting-item"));
	const hit = items.find((item) => item.querySelector(".setting-item-name")?.textContent === name);
	if (!hit) throw new Error(`setting ${name} not found`);
	return hit;
}

function nthSetting(root: HTMLElement, name: string, index: number): HTMLElement {
	const items = Array.from(root.querySelectorAll<HTMLElement>(".setting-item")).filter(
		(item) => item.querySelector(".setting-item-name")?.textContent === name,
	);
	return items[index];
}

describe("TranslateBlockSettingTab", () => {
	let plugin: TranslateBlockPlugin;
	let tab: TranslateBlockSettingTab;

	beforeEach(async () => {
		plugin = await makePlugin();
		tab = new TranslateBlockSettingTab(plugin.app, plugin);
		tab.display();
	});
	afterEach(() => {
		document.body.innerHTML = "";
		Notice.all = [];
	});

	it("renders headings and provider blocks", () => {
		const headings = Array.from(tab.containerEl.querySelectorAll(".setting-item-heading .setting-item-name")).map(
			(e) => e.textContent,
		);
		expect(headings).toEqual(["Provider", "Ollama", "OpenRouter", "Open WebUI", "Translation", "Advanced"]);
		expect(tab.containerEl.querySelectorAll(".setting-item-name").length).toBeGreaterThan(10);
		// Ollama has no API key field; OpenRouter has no base URL field.
		expect(tab.containerEl.querySelectorAll('input[type="password"]')).toHaveLength(2);
		expect(nthSetting(tab.containerEl, "Base URL", 1)).toBeDefined();
		expect(nthSetting(tab.containerEl, "Base URL", 2)).toBeUndefined();
	});

	it("switches the active provider and edits base URLs", async () => {
		const select = settingByName(tab.containerEl, "Active provider").querySelector("select")!;
		select.value = "openwebui";
		fire(select, "change");
		await flush();
		expect(plugin.settings.activeProvider).toBe("openwebui");

		const baseUrl = nthSetting(tab.containerEl, "Base URL", 0).querySelector("input")!;
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
		const key = nthSetting(tab.containerEl, "API key", 0).querySelector("input")!;
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

	it("fetches models into the dropdown and reports failures", async () => {
		const list = jest.spyOn(plugin.getBackend(), "listModels").mockResolvedValue(["m2", "m1"]);
		const modelSetting = nthSetting(tab.containerEl, "Model", 1);
		const button = modelSetting.querySelector("button")!;
		const dropdown = modelSetting.querySelector("select")!;
		expect(dropdown.disabled).toBe(true);
		button.click();
		expect(button.disabled).toBe(true);
		await flush();
		expect(dropdown.disabled).toBe(false);
		expect(Array.from(dropdown.options).map((o) => o.value)).toEqual(["m2", "m1"]);
		expect(Notice.all[0].message).toBe("Fetched 2 models from OpenRouter.");
		expect(button.disabled).toBe(false);

		dropdown.value = "m2";
		fire(dropdown, "change");
		await flush();
		expect(plugin.settings.providers.openrouter.selectedModel).toBe("m2");

		list.mockRejectedValue(new Error("HTTP 401"));
		button.click();
		await flush();
		expect(Notice.all[1].message).toContain("Could not fetch models from OpenRouter: HTTP 401");

		list.mockResolvedValue(["only"]);
		nthSetting(tab.containerEl, "Model", 0).querySelector("button")!.click();
		await flush();
		expect(Notice.all[2].message).toBe("Fetched 1 model from Ollama.");
	});

	it("edits languages, prompt, numbers, headers and debug", async () => {
		const source = settingByName(tab.containerEl, "Default source language").querySelector("select")!;
		source.value = "ja";
		fire(source, "change");
		const target = settingByName(tab.containerEl, "Default target language").querySelector("select")!;
		target.value = "de";
		fire(target, "change");
		await flush();
		expect(plugin.settings.defaultSourceLang).toBe("ja");
		expect(plugin.settings.defaultTargetLang).toBe("de");

		const prompt = settingByName(tab.containerEl, "Default prompt").querySelector("textarea")!;
		prompt.value = "  Custom {{targetLang}}  ";
		fire(prompt, "input");
		await flush();
		expect(plugin.settings.defaultPrompt).toBe("Custom {{targetLang}}");
		prompt.value = "";
		fire(prompt, "input");
		await flush();
		expect(plugin.settings.defaultPrompt).toContain("professional translator");

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

describe("populateModelDropdown", () => {
	it("shows a disabled hint for an empty list and selects a fallback otherwise", () => {
		const setting = new Setting(document.body);
		let dd: any;
		setting.addDropdown((d) => (dd = d));
		populateModelDropdown(dd, [], "x");
		expect(dd.selectEl.disabled).toBe(true);
		expect(dd.getValue()).toBe("");
		populateModelDropdown(dd, ["a", "b"], "zzz");
		expect(dd.getValue()).toBe("a");
		expect(dd.selectEl.disabled).toBe(false);
	});
});
