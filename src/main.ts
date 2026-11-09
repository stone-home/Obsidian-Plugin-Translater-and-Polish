import { Editor, Menu, Notice, Plugin } from "obsidian";
import { freshDefaultSettings } from "./defaults";
import { resolveLanguage } from "./languages";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderId, providerUsesApiKey, secretId } from "./providers";
import { PopoverAnchor, QuickTranslatePopover } from "./quick-translate-popover";
import { DEFAULT_SETTINGS, TranslateBlockSettingTab, TranslateBlockSettings } from "./settings";
import { migrateSettings } from "./settings-migration";
import { TranslateModal } from "./translate-modal";
import { ProviderRequest, TranslationBackend, createDefaultBackend } from "./translation-backend";
import { runTranslate } from "./translation-job";

export default class TranslateBlockPlugin extends Plugin {
	settings: TranslateBlockSettings = freshDefaultSettings();
	private backend: TranslationBackend | undefined;
	private readonly openModals = new Set<TranslateModal>();

	async onload() {
		await this.loadSettings();
		this.backend = createDefaultBackend();

		this.addSettingTab(new TranslateBlockSettingTab(this.app, this));
		this.registerSelectionCommands();
	}

	onunload() {
		QuickTranslatePopover.closeCurrent();
		for (const modal of Array.from(this.openModals)) {
			modal.close();
		}
		this.openModals.clear();
	}

	/** Modals register here so they can be closed when the plugin unloads. */
	trackModal(modal: TranslateModal, open: boolean): void {
		if (open) this.openModals.add(modal);
		else this.openModals.delete(modal);
	}

	// ---------------------------------------------------------------- entry points

	private registerSelectionCommands(): void {
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				if (!editor.somethingSelected()) return;
				menu.addItem((item) =>
					item
						.setTitle("Quick translate")
						.setIcon("languages")
						.setSection("translate-block")
						.onClick((evt) => this.openQuickTranslate(editor, evt)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Translate & polish…")
						.setIcon("languages")
						.setSection("translate-block")
						.onClick(() => this.openTranslateModal(editor)),
				);
			}),
		);

		this.addCommand({
			id: "quick-translate-selection",
			name: "Quick translate selection",
			editorCheckCallback: (checking, editor) => {
				if (!editor.somethingSelected()) return false;
				if (!checking) this.openQuickTranslate(editor);
				return true;
			},
		});
		this.addCommand({
			id: "translate-polish-selection",
			name: "Translate & polish selection",
			editorCheckCallback: (checking, editor) => {
				if (!editor.somethingSelected()) return false;
				if (!checking) this.openTranslateModal(editor);
				return true;
			},
		});
		this.addCommand({
			id: "open-translate-modal",
			name: "Open translate & polish window",
			editorCallback: (editor) => this.openTranslateModal(editor),
		});
		this.addCommand({
			id: "translate-replace-selection",
			name: "Translate and replace selection",
			editorCheckCallback: (checking, editor) => {
				if (!editor.somethingSelected()) return false;
				if (!checking) void this.translateAndReplaceSelection(editor);
				return true;
			},
		});
	}

	openTranslateModal(editor: Editor): void {
		QuickTranslatePopover.closeCurrent();
		const selection = editor.getSelection();
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		new TranslateModal(this.app, this, editor, from, to, selection).open();
	}

	openQuickTranslate(editor: Editor, evt?: MouseEvent | KeyboardEvent): void {
		const selection = editor.getSelection();
		if (!selection) return;
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		QuickTranslatePopover.open(this, editor, from, to, selection, this.selectionAnchor(evt));
	}

	/** Screen rectangle of the DOM selection, else the pointer, else the viewport's upper third. */
	private selectionAnchor(evt?: MouseEvent | KeyboardEvent): PopoverAnchor {
		const domSelection = activeWindow.getSelection();
		if (domSelection && domSelection.rangeCount > 0) {
			const range = domSelection.getRangeAt(0);
			const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;
			if (rect && (rect.width > 0 || rect.height > 0)) {
				return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
			}
		}
		if (evt && evt.instanceOf(MouseEvent) && (evt.clientX || evt.clientY)) {
			return { left: evt.clientX, right: evt.clientX, top: evt.clientY, bottom: evt.clientY };
		}
		const x = activeWindow.innerWidth / 2 - 200;
		const y = activeWindow.innerHeight / 3;
		return { left: x, right: x, top: y, bottom: y };
	}

	async translateAndReplaceSelection(editor: Editor): Promise<void> {
		const selection = editor.getSelection();
		if (!selection) return;
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const notice = new Notice("Translating…", 0);
		await runTranslate(
			this,
			{
				sourceText: selection,
				sourceLang: this.settings.defaultSourceLang,
				targetLang: this.settings.defaultTargetLang,
			},
			{
				onStatus: (message) => notice.setMessage(message),
				onResult: (result) => {
					if (editor.getRange(from, to) !== selection) {
						notice.hide();
						new Notice("Selection changed while translating; nothing was replaced.");
						return;
					}
					editor.replaceRange(result, from, to);
					notice.hide();
				},
				onError: (message) => {
					notice.setMessage(message);
					window.setTimeout(() => notice.hide(), 6000);
				},
			},
		);
	}

	// ---------------------------------------------------------------- providers

	getBackend(): TranslationBackend {
		if (!this.backend) {
			this.backend = createDefaultBackend();
		}
		return this.backend;
	}

	getApiKey(id: ProviderId): string {
		return this.app.secretStorage.getSecret(secretId(id)) ?? "";
	}

	setApiKey(id: ProviderId, value: string): void {
		try {
			this.app.secretStorage.setSecret(secretId(id), value);
		} catch (error) {
			new Notice(
				`Translate Block: could not store ${PROVIDER_LABELS[id]} API key. ` +
					(error instanceof Error ? error.message : String(error)),
			);
		}
	}

	/** Request fields shared by completion and list-models calls for a provider. */
	buildProviderRequest(id: ProviderId): ProviderRequest {
		const config = this.settings.providers[id];
		return {
			provider: id,
			baseUrl: config.baseUrl,
			apiKey: providerUsesApiKey(id) ? this.getApiKey(id) : "",
			extraHeadersRaw: config.extraHeadersRaw,
			timeoutMs: this.settings.timeoutMs,
			debug: this.settings.debug,
		};
	}

	/** Fetches the provider's model list, stores it, and returns it. Throws on failure. */
	async fetchModels(id: ProviderId): Promise<string[]> {
		const models = await this.getBackend().listModels(this.buildProviderRequest(id));
		this.settings.providers[id].models = models;
		await this.saveSettings();
		return models;
	}

	/**
	 * Fetches models from every provider that is configured (Ollama always; the
	 * others when an API key is set). Failures are collected, not thrown.
	 */
	async fetchAllModels(): Promise<string> {
		const parts: string[] = [];
		for (const id of PROVIDER_IDS) {
			if (providerUsesApiKey(id) && !this.getApiKey(id)) continue;
			try {
				const models = await this.fetchModels(id);
				parts.push(`${PROVIDER_LABELS[id]}: ${models.length}`);
			} catch (error) {
				parts.push(`${PROVIDER_LABELS[id]}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return parts.length > 0 ? `Models fetched. ${parts.join(" · ")}` : "No provider is configured yet.";
	}

	// ---------------------------------------------------------------- settings

	private async loadSettings() {
		const { settings, legacyApiKey, migrated } = migrateSettings(await this.loadData());
		this.settings = settings;
		if (legacyApiKey) {
			this.setApiKey("ollama", legacyApiKey);
		}
		if (migrated) {
			await this.saveData(this.settings);
		}
	}

	async saveSettings() {
		this.settings.defaultSourceLang = resolveLanguage(
			this.settings.defaultSourceLang,
			DEFAULT_SETTINGS.defaultSourceLang,
		);
		this.settings.defaultTargetLang = resolveLanguage(
			this.settings.defaultTargetLang,
			DEFAULT_SETTINGS.defaultTargetLang,
		);
		await this.saveData(this.settings);
	}
}
