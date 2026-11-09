import { Editor, MarkdownPostProcessorContext, Menu, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { populateModelSelect, resolveModel } from "./models";
import { resolveLanguage } from "./languages";
import { DEFAULT_SETTINGS, TranslateBlockSettingTab, TranslateBlockSettings } from "./settings";
import { freshDefaultSettings } from "./defaults";
import { PROVIDER_LABELS, ProviderConfig, ProviderId, secretId } from "./providers";
import { migrateSettings } from "./settings-migration";
import { ProviderRequest, TranslationBackend, createDefaultBackend } from "./translation-backend";
import { PopoverAnchor, QuickTranslatePopover } from "./quick-translate-popover";
import { TranslateModal } from "./translate-modal";
import { runTranslationJob } from "./translation-job";
import { TranslatePanelView, VIEW_TYPE_TRANSLATE_PANEL } from "./translate-panel-view";
import {
	TranslateWorkspaceHost,
	TranslateWorkspaceState,
	mountTranslateWorkspace,
} from "./translate-workspace";

export default class TranslateBlockPlugin extends Plugin {
	settings: TranslateBlockSettings = freshDefaultSettings();
	private workspaceStates = new Map<string, TranslateWorkspaceState>();
	private backend: TranslationBackend | undefined;
	private pollIntervalId: number | undefined;

	async onload() {
		await this.loadSettings();
		this.backend = createDefaultBackend();

		this.registerView(VIEW_TYPE_TRANSLATE_PANEL, (leaf) => new TranslatePanelView(leaf, this));

		this.addRibbonIcon("languages", "Open Translate Panel", () => {
			void this.activateTranslatePanel();
		});

		this.addCommand({
			id: "open-translate-panel",
			name: "Open Translate Panel",
			callback: () => {
				void this.activateTranslatePanel();
			},
		});

		this.registerMarkdownCodeBlockProcessor("translate-block", (source, el, ctx) => {
			this.processTranslateBlock(source, el, ctx);
		});

		this.addSettingTab(new TranslateBlockSettingTab(this.app, this));

		this.registerSelectionCommands();
		this.startPolling();
	}

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
			const rect = domSelection.getRangeAt(0).getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
			}
		}
		if (evt instanceof MouseEvent && (evt.clientX || evt.clientY)) {
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
		await runTranslationJob(
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
					editor.replaceRange(result.directTranslation, from, to);
					notice.hide();
				},
				onError: (message) => {
					notice.setMessage(message);
					window.setTimeout(() => notice.hide(), 6000);
				},
			},
		);
	}

	getBackend(): TranslationBackend {
		if (!this.backend) {
			this.backend = createDefaultBackend();
		}
		return this.backend;
	}

	onunload() {
		if (this.pollIntervalId !== undefined) {
			window.clearInterval(this.pollIntervalId);
		}
		this.workspaceStates.clear();
	}

	/** Narrow API for TranslateWorkspace mounts (panel + blocks). */
	getWorkspaceHost(): TranslateWorkspaceHost {
		return {
			getModelList: () => this.getModelList(),
			defaultSourceLang: this.settings.defaultSourceLang,
			defaultTargetLang: this.settings.defaultTargetLang,
			defaultModel: this.getActiveProvider().config.selectedModel,
			isValidLang: (value) => this.isValidLang(value),
			registerWorkspace: (state) => this.registerWorkspace(state),
			triggerManualTranslate: (id) => this.triggerManualTranslate(id),
		};
	}

	getModelList(): string[] {
		return [...this.getActiveProvider().config.models];
	}

	getActiveProvider(): { id: ProviderId; config: ProviderConfig } {
		const id = this.settings.activeProvider;
		return { id, config: this.settings.providers[id] };
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

	/** Request fields shared by translate and list-models calls for a provider. */
	buildProviderRequest(id: ProviderId): ProviderRequest {
		const config = this.settings.providers[id];
		return {
			provider: id,
			baseUrl: config.baseUrl,
			apiKey: this.getApiKey(id),
			extraHeadersRaw: config.extraHeadersRaw,
			timeoutMs: this.settings.timeoutMs,
			debug: this.settings.debug,
		};
	}

	/** Fetches the provider's model list, stores it, and returns it. Throws on failure. */
	async fetchModels(id: ProviderId): Promise<string[]> {
		if (!this.backend) {
			this.backend = createDefaultBackend();
		}
		const models = await this.backend.listModels(this.buildProviderRequest(id));
		const config = this.settings.providers[id];
		config.models = models;
		config.selectedModel = models.length > 0 ? resolveModel(models, config.selectedModel) : config.selectedModel;
		await this.saveSettings();
		if (id === this.settings.activeProvider) {
			this.refreshWorkspaceModelOptions();
		}
		return models;
	}

	registerWorkspace(incoming: TranslateWorkspaceState): void {
		const existing = this.workspaceStates.get(incoming.id);
		if (existing) {
			incoming.mode = existing.mode;
			incoming.inFlight = existing.inFlight;
			incoming.lastSourceHash = existing.lastSourceHash;
			incoming.retryCount = existing.retryCount;
			incoming.lastError = existing.lastError;
			incoming.lastUpdatedAt = existing.lastUpdatedAt;
		}
		this.workspaceStates.set(incoming.id, incoming);
	}

	unregisterWorkspace(id: string): void {
		this.workspaceStates.delete(id);
	}

	refreshWorkspaceModelOptions(): void {
		const list = this.getModelList();
		for (const state of this.workspaceStates.values()) {
			state.model = resolveModel(list, state.model);
			if (state.modelSelectEl) {
				populateModelSelect(state.modelSelectEl, list, state.model);
			}
		}
	}

	async activateTranslatePanel(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TRANSLATE_PANEL);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		const rightLeaf = workspace.getRightLeaf(false);
		const leaf: WorkspaceLeaf = rightLeaf ?? workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_TRANSLATE_PANEL, active: true });
		workspace.revealLeaf(leaf);
	}

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
		const { config } = this.getActiveProvider();
		if (config.models.length > 0) {
			config.selectedModel = resolveModel(config.models, config.selectedModel);
		}
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

	private startPolling() {
		this.pollIntervalId = window.setInterval(() => {
			void this.pollWorkspaces();
		}, 1000);
		this.registerInterval(this.pollIntervalId);
	}

	private processTranslateBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const decodedSource = this.decodeBlockContent(source);
		const blockId = this.getBlockId(ctx, el);
		const info = ctx.getSectionInfo(el);
		const fenceConfig = this.parseFenceConfig(ctx, el);
		const models = this.getModelList();

		el.empty();

		const onSaveToBlock =
			info && info.lineStart != null && info.lineEnd != null
				? () => {
						const lines = info.text.split("\n");
						const fenceLine =
							lines.find((line) => line.trim().startsWith("```translate-block")) ??
							"```translate-block";
						const state = this.workspaceStates.get(blockId);
						const content = state?.sourceText ?? decodedSource;
						void this.updateCodeBlockInFile(
							ctx.sourcePath,
							info.lineStart,
							info.lineEnd,
							fenceLine,
							content,
						);
					}
				: undefined;

		mountTranslateWorkspace(el, this.getWorkspaceHost(), {
			id: blockId,
			initialSourceText: decodedSource,
			initialSourceLang: fenceConfig.sourceLang || this.settings.defaultSourceLang,
			initialTargetLang: fenceConfig.targetLang || this.settings.defaultTargetLang,
			initialModel: resolveModel(models, fenceConfig.model || this.getActiveProvider().config.selectedModel),
			prompt: fenceConfig.prompt?.trim() || this.settings.defaultPrompt,
			onSaveToBlock,
		});
	}

	private parseFenceConfig(
		ctx: MarkdownPostProcessorContext,
		el: HTMLElement,
	): Partial<Pick<TranslateWorkspaceState, "sourceLang" | "targetLang" | "model" | "prompt">> {
		const info = ctx.getSectionInfo(el);
		if (!info || !info.text) {
			return {};
		}

		const lines = info.text.split("\n");
		const fenceLine = lines.find((line) => line.trim().startsWith("```translate-block"));
		if (!fenceLine) {
			return {};
		}

		const trimmed = fenceLine.trim();
		const withoutTicks = trimmed.startsWith("```") ? trimmed.slice(3).trim() : trimmed;
		const parts = withoutTicks.split(/\s+/);
		const [, ...rest] = parts;

		const result: Partial<Pick<TranslateWorkspaceState, "sourceLang" | "targetLang" | "model" | "prompt">> =
			{};

		for (const token of rest) {
			const eqIndex = token.indexOf("=");
			if (eqIndex === -1) continue;
			const key = token.slice(0, eqIndex).trim();
			const value = token.slice(eqIndex + 1).trim();
			if (!key || !value) continue;

			switch (key) {
				case "source":
				case "sourceLang":
					if (this.isValidLang(value)) {
						result.sourceLang = value;
					}
					break;
				case "target":
				case "targetLang":
					if (this.isValidLang(value)) {
						result.targetLang = value;
					}
					break;
				case "model":
					result.model = value;
					break;
				case "prompt":
					result.prompt = value;
					break;
				default:
					break;
			}
		}

		return result;
	}

	private getBlockId(ctx: MarkdownPostProcessorContext, el: HTMLElement): string {
		const info = ctx.getSectionInfo(el);
		if (info) {
			return `${ctx.sourcePath}:${info.lineStart}-${info.lineEnd}`;
		}
		return `${ctx.sourcePath}:${Math.random().toString(36).slice(2)}`;
	}

	/** Zero-width space used to escape fence-like lines so they do not close the code block. */
	private static readonly FENCE_ESCAPE = "\u200B";

	/**
	 * Encodes block content for saving: appends U+200B to any line that could be
	 * interpreted as a closing fence (optional leading/trailing whitespace + 3+ backticks).
	 */
	private encodeBlockContentForSave(content: string): string {
		const re = /^\s*`{3,}\s*$/;
		return content
			.split(/\r?\n/)
			.map((line) => (re.test(line) ? line + TranslateBlockPlugin.FENCE_ESCAPE : line))
			.join("\n");
	}

	/**
	 * Decodes block content when loading: removes the trailing U+200B from lines
	 * we encoded (fence-like line + U+200B), restoring the original fence line.
	 */
	private decodeBlockContent(source: string): string {
		const re = /^(\s*`{3,}\s*)\u200B$/;
		return source
			.split(/\r?\n/)
			.map((line) => line.replace(re, "$1"))
			.join("\n");
	}

	/**
	 * Updates the code block content in the note file.
	 * lineStart/lineEnd are 0-based (inclusive) indices into the file's line array.
	 */
	private async updateCodeBlockInFile(
		sourcePath: string,
		lineStart: number,
		lineEnd: number,
		fenceLine: string,
		newContent: string,
	): Promise<void> {
		const file = this.app.vault.getFileByPath(sourcePath);
		if (!file) return;
		try {
			const content = await this.app.vault.read(file);
			const lines = content.split(/\r?\n/);
			const before = lines.slice(0, lineStart);
			const after = lines.slice(lineEnd + 1);
			const encoded = this.encodeBlockContentForSave(newContent);
			const newBlockLines = [fenceLine, ...encoded.split(/\r?\n/), "```"];
			const newFileContent = [...before, ...newBlockLines, ...after].join("\n");
			await this.app.vault.modify(file, newFileContent);
		} catch (e) {
			new Notice(
				"Translate Block: could not update note. " + (e instanceof Error ? e.message : String(e)),
			);
		}
	}

	private async pollWorkspaces() {
		if (!this.backend) {
			this.backend = createDefaultBackend();
		}
		for (const state of this.workspaceStates.values()) {
			if (state.mode !== "auto") continue;
			if (state.inFlight) continue;

			if (state.sourceText.length > this.settings.maxChars) {
				state.statusEl.setText(
					`Block too large for auto-translate (>${this.settings.maxChars} chars). Use manual Translate.`,
				);
				continue;
			}

			const hash = this.computeHash(state);
			if (state.lastSourceHash === hash) {
				continue;
			}

			await this.runTranslationJob(state.id);
		}
	}

	private computeHash(state: TranslateWorkspaceState): string {
		const key = [state.sourceText, state.sourceLang, state.targetLang, state.model, state.prompt].join(
			"||",
		);
		let hash = 0;
		for (let i = 0; i < key.length; i += 1) {
			// eslint-disable-next-line no-bitwise
			hash = (hash << 5) - hash + key.charCodeAt(i);
			// eslint-disable-next-line no-bitwise
			hash |= 0;
		}
		return String(hash);
	}

	private isValidLang(value: string): boolean {
		const v = value.trim();
		if (!v) return false;
		return /^[a-zA-Z-]+$/.test(v);
	}

	private async triggerManualTranslate(blockId: string) {
		await this.runTranslationJob(blockId);
	}

	private async runTranslationJob(blockId: string) {
		const state = this.workspaceStates.get(blockId);
		if (!state || state.inFlight) return;
		state.inFlight = true;
		state.lastError = undefined;
		const hash = this.computeHash(state);
		const result = await runTranslationJob(
			this,
			{
				sourceText: state.sourceText,
				sourceLang: state.sourceLang,
				targetLang: state.targetLang,
				model: state.model,
				prompt: state.prompt,
			},
			{
				onStatus: (message) => state.statusEl.setText(message),
				onResult: (translated) => {
					state.outputEl.empty();
					const pre = state.outputEl.createEl("pre", {
						text: translated.directTranslation,
						cls: "translate-block-output-pre",
					});
					pre.setAttribute("contenteditable", "false");
					state.lastUpdatedAt = Date.now();
					state.statusEl.setText("Translated successfully.");
				},
				onError: (message) => {
					state.lastError = message;
					state.statusEl.setText(message);
				},
			},
		);
		state.inFlight = false;
		state.lastSourceHash = hash;
		if (!result) {
			new Notice("Translate Block error. See status for details.");
		}
	}
}
