import { App, ButtonComponent, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import TranslatePolishPlugin from "./main";
import { DEFAULT_SETTINGS, TASK_IDS, TASK_LABELS, TaskId } from "./defaults";
import { LANGUAGE_OPTIONS, resolveLanguage } from "./languages";
import { decodeBinding, fillTaskModelSelect } from "./model-picker";
import {
	PROVIDER_DEFAULTS,
	PROVIDER_IDS,
	PROVIDER_LABELS,
	ProviderId,
	normalizeBaseUrl,
	providerHasBaseUrl,
	providerUsesApiKey,
} from "./providers";

export type { TranslatePolishSettings } from "./defaults";
export { DEFAULT_SETTINGS } from "./defaults";

const TASK_DESCRIPTIONS: Record<TaskId, string> = {
	translate: "Model that translates the text. Dedicated translation models (e.g. translategemma) work well here.",
	rewrite: "Model that rewrites your text as a native speaker and explains the changes. Needs a general instruction-following model.",
};

export class TranslatePolishSettingTab extends PluginSettingTab {
	plugin: TranslatePolishPlugin;
	private taskSelects: Partial<Record<TaskId, HTMLSelectElement>> = {};
	private modelCountEls: Partial<Record<ProviderId, HTMLElement>> = {};

	constructor(app: App, plugin: TranslatePolishPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.taskSelects = {};
		this.modelCountEls = {};

		this.renderTasksSection(containerEl);
		for (const id of PROVIDER_IDS) {
			this.renderProviderConfig(containerEl, id);
		}
		this.renderTranslationSection(containerEl);
		this.renderAdvancedSection(containerEl);
	}

	private renderTasksSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Models").setHeading();
		for (const task of TASK_IDS) {
			new Setting(containerEl)
				.setName(`${TASK_LABELS[task]} model`)
				.setDesc(TASK_DESCRIPTIONS[task])
				.addDropdown((dropdown) => {
					this.taskSelects[task] = dropdown.selectEl;
					fillTaskModelSelect(dropdown.selectEl, this.plugin.settings, this.plugin.settings.tasks[task]);
					dropdown.onChange(async (value) => {
						const binding = decodeBinding(value);
						if (!binding) return;
						this.plugin.settings.tasks[task] = binding;
						await this.plugin.saveSettings();
					});
				});
		}
	}

	private refreshTaskSelects(): void {
		for (const task of TASK_IDS) {
			const select = this.taskSelects[task];
			if (select) fillTaskModelSelect(select, this.plugin.settings, this.plugin.settings.tasks[task]);
		}
	}

	private renderProviderConfig(containerEl: HTMLElement, id: ProviderId): void {
		const config = this.plugin.settings.providers[id];
		new Setting(containerEl).setName(PROVIDER_LABELS[id]).setHeading();

		if (providerHasBaseUrl(id)) {
			new Setting(containerEl)
				.setName("Base URL")
				.setDesc(`Server origin, without the endpoint path (default ${PROVIDER_DEFAULTS[id].baseUrl}).`)
				.addText((text) =>
					text
						.setPlaceholder(PROVIDER_DEFAULTS[id].baseUrl)
						.setValue(config.baseUrl)
						.onChange(async (value) => {
							config.baseUrl = normalizeBaseUrl(id, value);
							await this.plugin.saveSettings();
						}),
				);
		}

		if (providerUsesApiKey(id)) {
			new Setting(containerEl)
				.setName("API key")
				.setDesc("Stored in Obsidian's secret storage, not in the plugin data file.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.autocomplete = "off";
					const save = debounce((value: string) => this.plugin.setApiKey(id, value.trim()), 400, true);
					text.setPlaceholder("sk-…")
						.setValue(this.plugin.getApiKey(id))
						.onChange((value) => save(value));
					text.inputEl.addEventListener("blur", () => save.run());
				});
		}

		const modelsSetting = new Setting(containerEl)
			.setName("Available models")
			.setDesc(this.modelCountText(id));
		this.modelCountEls[id] = modelsSetting.descEl;
		modelsSetting.addButton((button: ButtonComponent) => {
			button.setButtonText("Fetch models").onClick(async () => {
				button.setDisabled(true).setButtonText("Fetching…");
				try {
					const models = await this.plugin.fetchModels(id);
					this.modelCountEls[id]?.setText(this.modelCountText(id));
					this.refreshTaskSelects();
					new Notice(`Fetched ${models.length} model${models.length === 1 ? "" : "s"} from ${PROVIDER_LABELS[id]}.`);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`Could not fetch models from ${PROVIDER_LABELS[id]}: ${message}`);
				} finally {
					button.setDisabled(false).setButtonText("Fetch models");
				}
			});
		});
	}

	private modelCountText(id: ProviderId): string {
		const count = this.plugin.settings.providers[id].models.length;
		if (count === 0) return "No models fetched yet. They appear in the model pickers above once fetched.";
		return `${count} model${count === 1 ? "" : "s"} available in the model pickers above.`;
	}

	private renderTranslationSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Translation").setHeading();

		new Setting(containerEl)
			.setName("Default source language")
			.setDesc("Language you write in. The native rewrite stays in this language.")
			.addDropdown((dropdown) => {
				for (const code of LANGUAGE_OPTIONS) {
					dropdown.addOption(code, code);
				}
				dropdown
					.setValue(resolveLanguage(this.plugin.settings.defaultSourceLang, DEFAULT_SETTINGS.defaultSourceLang))
					.onChange(async (value) => {
						this.plugin.settings.defaultSourceLang = resolveLanguage(value, DEFAULT_SETTINGS.defaultSourceLang);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Default target language")
			.setDesc("Language to translate into.")
			.addDropdown((dropdown) => {
				for (const code of LANGUAGE_OPTIONS) {
					dropdown.addOption(code, code);
				}
				dropdown
					.setValue(resolveLanguage(this.plugin.settings.defaultTargetLang, DEFAULT_SETTINGS.defaultTargetLang))
					.onChange(async (value) => {
						this.plugin.settings.defaultTargetLang = resolveLanguage(value, DEFAULT_SETTINGS.defaultTargetLang);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Translation prompt")
			.setDesc("System prompt for the translation model. You can use {{sourceLang}} and {{targetLang}}.")
			.setClass("setting-control-on-new-line")
			.addTextArea((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.translatePrompt)
					.setValue(this.plugin.settings.translatePrompt)
					.onChange(async (value) => {
						this.plugin.settings.translatePrompt = value.trim() || DEFAULT_SETTINGS.translatePrompt;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Rewrite prompt")
			.setDesc(
				"System prompt for the native-rewrite model. The ### NATIVE / ### SUGGESTIONS output format is appended automatically unless the prompt already contains ### NATIVE.",
			)
			.setClass("setting-control-on-new-line")
			.addTextArea((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.rewritePrompt)
					.setValue(this.plugin.settings.rewritePrompt)
					.onChange(async (value) => {
						this.plugin.settings.rewritePrompt = value.trim() || DEFAULT_SETTINGS.rewritePrompt;
						await this.plugin.saveSettings();
					}),
			);

		this.addNumberSetting(containerEl, "Live translate delay (ms)", "How long to wait after typing stops before the translate window re-runs.", "liveDelayMs");
		this.addNumberSetting(containerEl, "Max text size (characters)", "Longer texts are refused to protect against runaway requests.", "maxChars");
	}

	private renderAdvancedSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Advanced").setHeading();

		this.addNumberSetting(containerEl, "Request timeout (ms)", "Each request is abandoned after this long.", "timeoutMs");
		this.addNumberSetting(containerEl, "Max attempts", "Retries for a single request on network or server errors.", "maxAttempts");

		for (const id of PROVIDER_IDS) {
			const config = this.plugin.settings.providers[id];
			new Setting(containerEl)
				.setName(`Extra headers (${PROVIDER_LABELS[id]})`)
				.setDesc("Optional HTTP headers as Key: Value, one per line.")
				.setClass("setting-control-on-new-line")
				.addTextArea((text) =>
					text
						.setPlaceholder("X-Custom-Header: value")
						.setValue(config.extraHeadersRaw)
						.onChange(async (value) => {
							config.extraHeadersRaw = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Debug")
			.setDesc("Print request details to the developer console.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}),
			);
	}

	private addNumberSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: "liveDelayMs" | "maxChars" | "timeoutMs" | "maxAttempts",
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS[key]))
					.setValue(String(this.plugin.settings[key]))
					.onChange(async (value) => {
						const parsed = Number(value);
						this.plugin.settings[key] =
							Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_SETTINGS[key];
						await this.plugin.saveSettings();
					}),
			);
	}
}
