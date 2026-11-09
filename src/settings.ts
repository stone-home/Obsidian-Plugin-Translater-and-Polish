import { App, ButtonComponent, DropdownComponent, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import TranslateBlockPlugin from "./main";
import { DEFAULT_SETTINGS, TranslateBlockSettings } from "./defaults";
import { LANGUAGE_OPTIONS, resolveLanguage } from "./languages";
import {
	PROVIDER_DEFAULTS,
	PROVIDER_IDS,
	PROVIDER_LABELS,
	ProviderId,
	normalizeBaseUrl,
	providerHasBaseUrl,
	providerUsesApiKey,
} from "./providers";

export type { TranslateBlockSettings } from "./defaults";
export { DEFAULT_SETTINGS } from "./defaults";

/** Fills a model dropdown; shows a disabled hint when the list is empty. */
export function populateModelDropdown(dropdown: DropdownComponent, models: string[], selected: string): void {
	dropdown.selectEl.empty();
	if (models.length === 0) {
		dropdown.addOption("", "No models yet. Click Fetch models.");
		dropdown.setValue("");
		dropdown.setDisabled(true);
		return;
	}
	dropdown.setDisabled(false);
	for (const name of models) {
		dropdown.addOption(name, name);
	}
	dropdown.setValue(models.includes(selected) ? selected : models[0]);
}

export class TranslateBlockSettingTab extends PluginSettingTab {
	plugin: TranslateBlockPlugin;

	constructor(app: App, plugin: TranslateBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderProviderSection(containerEl);
		for (const id of PROVIDER_IDS) {
			this.renderProviderConfig(containerEl, id);
		}
		this.renderTranslationSection(containerEl);
		this.renderAdvancedSection(containerEl);
	}

	private renderProviderSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Provider").setHeading();

		new Setting(containerEl)
			.setName("Active provider")
			.setDesc("Backend used for translations.")
			.addDropdown((dropdown) => {
				for (const id of PROVIDER_IDS) {
					dropdown.addOption(id, PROVIDER_LABELS[id]);
				}
				dropdown.setValue(this.plugin.settings.activeProvider).onChange(async (value) => {
					this.plugin.settings.activeProvider = value as ProviderId;
					await this.plugin.saveSettings();
				});
			});
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

		let modelDropdown: DropdownComponent | undefined;
		new Setting(containerEl)
			.setName("Model")
			.setDesc("Model used for requests. Fetch models to refresh the list from the server.")
			.addDropdown((dropdown) => {
				modelDropdown = dropdown;
				populateModelDropdown(dropdown, config.models, config.selectedModel);
				dropdown.onChange(async (value) => {
					config.selectedModel = value;
					await this.plugin.saveSettings();
				});
			})
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Fetch models").onClick(async () => {
					button.setDisabled(true).setButtonText("Fetching…");
					try {
						const models = await this.plugin.fetchModels(id);
						if (modelDropdown) {
							populateModelDropdown(modelDropdown, models, config.selectedModel);
						}
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

	private renderTranslationSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Translation").setHeading();

		new Setting(containerEl)
			.setName("Default source language")
			.setDesc("Language of the source text.")
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
			.setName("Default prompt")
			.setDesc(
				"Prompt template. You can use {{sourceLang}} and {{targetLang}}. The three-section output format is appended automatically unless the prompt already contains ### DIRECT.",
			)
			.setClass("setting-control-on-new-line")
			.addTextArea((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.defaultPrompt)
					.setValue(this.plugin.settings.defaultPrompt)
					.onChange(async (value) => {
						this.plugin.settings.defaultPrompt = value.trim() || DEFAULT_SETTINGS.defaultPrompt;
						await this.plugin.saveSettings();
					}),
			);

		this.addNumberSetting(containerEl, "Live translate delay (ms)", "How long to wait after typing stops before the translate window re-translates.", "liveDelayMs");
		this.addNumberSetting(containerEl, "Max text size (characters)", "Longer texts are refused to protect against runaway requests.", "maxChars");
	}

	private renderAdvancedSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Advanced").setHeading();

		this.addNumberSetting(containerEl, "Request timeout (ms)", "Each request is abandoned after this long.", "timeoutMs");
		this.addNumberSetting(containerEl, "Max attempts", "Retries for a single translation on network or server errors.", "maxAttempts");

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
