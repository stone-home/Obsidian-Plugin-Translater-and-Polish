import { App, Editor, EditorPosition, Modal, Notice, debounce, setIcon } from "obsidian";
import type TranslateBlockPlugin from "./main";
import { TASK_IDS, TASK_LABELS, TaskId } from "./defaults";
import { populateLanguageSelect } from "./languages";
import { decodeBinding, fillTaskModelSelect } from "./model-picker";
import { RewriteResult } from "./response-parser";
import { runRewrite, runTranslate } from "./translation-job";

type Variant = "native" | "direct";

/** Builds an Obsidian callout quoting `text`. */
export function buildCallout(text: string, targetLang: string): string {
	const body = text.split("\n").map((line) => `> ${line}`);
	return [`> [!translate] ${targetLang}`, ...body].join("\n");
}

/**
 * Centered translate & polish workbench. Runs the translation and the native
 * rewrite as two independent requests and locks the editor and selection it
 * was opened from so results can be written back even after focus moved.
 */
export class TranslateModal extends Modal {
	private readonly plugin: TranslateBlockPlugin;
	private readonly editor: Editor | null;
	private readonly from: EditorPosition | null;
	private readonly to: EditorPosition | null;
	private readonly initialText: string;
	private readonly hasSelection: boolean;

	private sourceLang: string;
	private targetLang: string;
	private seq = 0;
	private translation: string | undefined;
	private rewrite: RewriteResult | undefined;
	private chosen: Variant = "native";
	private startedAt = 0;
	private pending = 0;

	private sourceEl!: HTMLTextAreaElement;
	private statusEl!: HTMLElement;
	private taskSelects: Partial<Record<TaskId, HTMLSelectElement>> = {};
	private nativeCard!: HTMLElement;
	private directCard!: HTMLElement;
	private nativeBody!: HTMLElement;
	private directBody!: HTMLElement;
	private suggestionsEl!: HTMLDetailsElement;
	private suggestionsList!: HTMLElement;
	private suggestionsSummary!: HTMLElement;
	private applyButton!: HTMLButtonElement;
	private calloutButton!: HTMLButtonElement;
	private copyButton!: HTMLButtonElement;

	private readonly scheduleRun: ReturnType<typeof debounce<[], void>>;

	constructor(
		app: App,
		plugin: TranslateBlockPlugin,
		editor: Editor | null,
		from: EditorPosition | null,
		to: EditorPosition | null,
		initialText: string,
	) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.from = from;
		this.to = to;
		this.initialText = initialText;
		this.hasSelection = initialText.length > 0 && from !== null && to !== null;
		this.sourceLang = plugin.settings.defaultSourceLang;
		this.targetLang = plugin.settings.defaultTargetLang;
		this.scheduleRun = debounce(
			() => {
				void this.run();
			},
			Math.max(100, plugin.settings.liveDelayMs),
			true,
		);
	}

	onOpen(): void {
		this.plugin.trackModal(this, true);
		this.setTitle("Translate & polish");
		this.modalEl.addClass("translate-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("translate-modal-content");

		this.buildToolbar(contentEl.createDiv({ cls: "translate-modal-toolbar" }));

		const columns = contentEl.createDiv({ cls: "translate-modal-columns" });
		this.buildSourceColumn(columns.createDiv({ cls: "translate-modal-source" }));
		this.buildResultColumn(columns.createDiv({ cls: "translate-modal-results" }));

		this.buildFooter(contentEl.createDiv({ cls: "translate-modal-footer" }));

		this.scope.register(["Mod"], "Enter", () => {
			void this.run();
			return false;
		});

		this.sourceEl.value = this.initialText;
		window.setTimeout(() => this.sourceEl.focus(), 0);
		if (this.initialText.trim()) {
			void this.run();
		} else {
			this.setStatus("Type or paste text. Translation runs after you pause.");
		}
	}

	onClose(): void {
		this.plugin.trackModal(this, false);
		this.seq += 1;
		this.scheduleRun.cancel();
		this.contentEl.empty();
	}

	private buildToolbar(bar: HTMLElement): void {
		for (const task of TASK_IDS) {
			const wrap = bar.createDiv({ cls: "translate-modal-task" });
			wrap.createSpan({ cls: "translate-modal-task-label", text: TASK_LABELS[task] });
			const select = wrap.createEl("select", { cls: "dropdown translate-modal-model" });
			this.taskSelects[task] = select;
			fillTaskModelSelect(select, this.plugin.settings, this.plugin.settings.tasks[task]);
			select.addEventListener("change", () => {
				void (async () => {
					const binding = decodeBinding(select.value);
					if (!binding) return;
					this.plugin.settings.tasks[task] = binding;
					await this.plugin.saveSettings();
					this.scheduleRun();
				})();
			});
		}

		const refresh = bar.createEl("button", {
			cls: "clickable-icon translate-modal-icon",
			attr: { "aria-label": "Fetch models from all providers" },
		});
		setIcon(refresh, "refresh-cw");
		refresh.addEventListener("click", () => {
			void (async () => {
				refresh.addClass("is-loading");
				try {
					const summary = await this.plugin.fetchAllModels();
					this.refreshTaskSelects();
					new Notice(summary);
				} finally {
					refresh.removeClass("is-loading");
				}
			})();
		});

		bar.createDiv({ cls: "translate-modal-spacer" });

		const sourceSelect = bar.createEl("select", { cls: "dropdown" });
		populateLanguageSelect(sourceSelect, this.sourceLang);
		sourceSelect.addEventListener("change", () => {
			this.sourceLang = sourceSelect.value;
			this.scheduleRun();
		});

		const swap = bar.createEl("button", { cls: "clickable-icon translate-modal-icon", attr: { "aria-label": "Swap languages" } });
		setIcon(swap, "arrow-left-right");
		swap.addEventListener("click", () => {
			if (this.sourceLang === "auto") {
				new Notice("Pick a source language before swapping.");
				return;
			}
			const next = this.sourceLang;
			this.sourceLang = this.targetLang;
			this.targetLang = next;
			populateLanguageSelect(sourceSelect, this.sourceLang);
			populateLanguageSelect(targetSelect, this.targetLang);
			this.scheduleRun();
		});

		const targetSelect = bar.createEl("select", { cls: "dropdown" });
		populateLanguageSelect(targetSelect, this.targetLang);
		targetSelect.addEventListener("change", () => {
			this.targetLang = targetSelect.value;
			this.scheduleRun();
		});
	}

	private refreshTaskSelects(): void {
		for (const task of TASK_IDS) {
			const select = this.taskSelects[task];
			if (select) fillTaskModelSelect(select, this.plugin.settings, this.plugin.settings.tasks[task]);
		}
	}

	private buildSourceColumn(column: HTMLElement): void {
		column.createDiv({ cls: "translate-modal-label", text: "Your text" });
		this.sourceEl = column.createEl("textarea", { cls: "translate-modal-textarea" });
		this.sourceEl.spellcheck = true;
		this.sourceEl.placeholder = "Type or paste the text you wrote…";
		this.sourceEl.addEventListener("input", () => {
			if (this.sourceEl.value.trim()) {
				this.scheduleRun();
			} else {
				this.scheduleRun.cancel();
				this.seq += 1;
				this.setStatus("Waiting for text.");
			}
		});
		this.statusEl = column.createDiv({ cls: "translate-modal-status" });
	}

	private buildResultColumn(column: HTMLElement): void {
		const native = this.buildCard(column, "native", "Native rewrite of your text");
		this.nativeCard = native.card;
		this.nativeBody = native.body;
		const direct = this.buildCard(column, "direct", "Translation");
		this.directCard = direct.card;
		this.directBody = direct.body;

		this.suggestionsEl = column.createEl("details", { cls: "translate-suggestions" });
		this.suggestionsSummary = this.suggestionsEl.createEl("summary", { text: "What changed" });
		this.suggestionsList = this.suggestionsEl.createEl("ul");
		this.suggestionsEl.hide();
		this.updateChosenHighlight();
	}

	private buildCard(parent: HTMLElement, variant: Variant, title: string): { card: HTMLElement; body: HTMLElement } {
		const card = parent.createDiv({ cls: `translate-card translate-card--${variant}` });
		const header = card.createDiv({ cls: "translate-card-header" });
		header.createSpan({ cls: "translate-card-title", text: title });
		const use = header.createEl("button", { cls: "translate-card-use", text: "Use this" });
		use.addEventListener("click", () => {
			this.chosen = variant;
			this.updateChosenHighlight();
			this.setResultButtonsEnabled(Boolean(this.chosenText()));
		});
		const body = card.createDiv({ cls: "translate-card-body", text: "—" });
		return { card, body };
	}

	private buildFooter(footer: HTMLElement): void {
		const translateNow = footer.createEl("button", { text: "Run now" });
		translateNow.setAttribute("aria-label", "Run now (Ctrl/Cmd+Enter)");
		translateNow.addEventListener("click", () => {
			void this.run();
		});

		footer.createDiv({ cls: "translate-modal-spacer" });

		this.applyButton = footer.createEl("button", {
			cls: "mod-cta",
			text: this.hasSelection ? "Replace selection" : "Insert at cursor",
		});
		this.applyButton.addEventListener("click", () => this.applyToEditor("plain"));

		this.calloutButton = footer.createEl("button", { text: "Insert as callout" });
		this.calloutButton.addEventListener("click", () => this.applyToEditor("callout"));

		this.copyButton = footer.createEl("button", { text: "Copy" });
		this.copyButton.addEventListener("click", () => {
			void navigator.clipboard.writeText(this.chosenText()).then(() => new Notice("Copied to clipboard."));
		});

		this.setResultButtonsEnabled(false);
	}

	private setResultButtonsEnabled(enabled: boolean): void {
		const editable = enabled && this.editor !== null;
		this.applyButton.disabled = !editable;
		this.calloutButton.disabled = !editable;
		this.copyButton.disabled = !enabled;
	}

	private setStatus(message: string): void {
		this.statusEl.setText(message);
	}

	private async run(): Promise<void> {
		this.scheduleRun.cancel();
		const text = this.sourceEl.value;
		const my = ++this.seq;
		const signal = { isStale: () => my !== this.seq };
		const input = { sourceText: text, sourceLang: this.sourceLang, targetLang: this.targetLang };

		this.startedAt = Date.now();
		this.pending = 2;
		this.translation = undefined;
		this.rewrite = undefined;
		this.setResultButtonsEnabled(false);
		this.suggestionsEl.hide();
		this.setStatus("Running…");

		const finishOne = (): void => {
			this.pending -= 1;
			if (this.pending === 0) {
				this.afterAllDone();
				const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
				this.setStatus(`Done in ${seconds} s · ${text.length} chars`);
			}
		};

		await Promise.all([
			runTranslate(
				this.plugin,
				input,
				{
					onStatus: (message) => this.directBody.setText(message),
					onResult: (translation) => {
						this.translation = translation;
						this.directBody.setText(translation || "—");
						this.setResultButtonsEnabled(Boolean(this.chosenText()));
						finishOne();
					},
					onError: (message) => {
						this.directBody.setText(message);
						finishOne();
					},
				},
				signal,
			),
			runRewrite(
				this.plugin,
				input,
				{
					onStatus: (message) => this.nativeBody.setText(message),
					onResult: (rewrite) => {
						this.rewrite = rewrite;
						this.nativeBody.setText(rewrite.nativeRewrite || "—");
						this.renderSuggestions(rewrite.suggestions);
						this.setResultButtonsEnabled(Boolean(this.chosenText()));
						finishOne();
					},
					onError: (message) => {
						this.nativeBody.setText(message);
						finishOne();
					},
				},
				signal,
			),
		]);
	}

	private renderSuggestions(suggestions: string[]): void {
		this.suggestionsList.empty();
		if (suggestions.length === 0) {
			this.suggestionsEl.hide();
			return;
		}
		for (const item of suggestions) {
			this.suggestionsList.createEl("li", { text: item });
		}
		this.suggestionsSummary.setText(`What changed (${suggestions.length})`);
		this.suggestionsEl.show();
	}

	/** Once both tasks settled: if the chosen card came back empty, highlight the one that has text. */
	private afterAllDone(): void {
		if (!this.chosenText()) {
			if (this.chosen === "native" && this.translation) this.chosen = "direct";
			else if (this.chosen === "direct" && this.rewrite?.nativeRewrite) this.chosen = "native";
		}
		this.updateChosenHighlight();
		this.setResultButtonsEnabled(Boolean(this.chosenText()));
	}

	private updateChosenHighlight(): void {
		this.nativeCard.toggleClass("is-selected", this.chosen === "native");
		this.directCard.toggleClass("is-selected", this.chosen === "direct");
	}

	private chosenText(): string {
		return this.chosen === "native" ? (this.rewrite?.nativeRewrite ?? "") : (this.translation ?? "");
	}

	private applyToEditor(mode: "plain" | "callout"): void {
		const text = this.chosenText();
		if (!text || !this.editor) return;
		const editor = this.editor;
		const payload = mode === "callout" ? buildCallout(text, this.chosen === "direct" ? this.targetLang : this.sourceLang) : text;

		try {
			this.writeBack(editor, payload, mode);
		} catch (error) {
			new Notice(
				"Could not write into the note (was it closed?). Use Copy instead. " +
					(error instanceof Error ? error.message : String(error)),
			);
			return;
		}
		this.close();
	}

	private writeBack(editor: Editor, payload: string, mode: "plain" | "callout"): void {
		if (this.hasSelection && this.from && this.to) {
			const unchanged = editor.getRange(this.from, this.to) === this.initialText;
			if (!unchanged) {
				editor.replaceRange(payload, editor.getCursor());
				new Notice("Selection changed while translating; inserted at the cursor instead.");
			} else if (mode === "callout") {
				// A selection ending at column 0 stops at the previous line's end.
				const lastLine = this.to.ch === 0 && this.to.line > this.from.line ? this.to.line - 1 : this.to.line;
				const lineEnd: EditorPosition = { line: lastLine, ch: editor.getLine(lastLine).length };
				editor.replaceRange(`\n${payload}`, lineEnd);
			} else {
				editor.replaceRange(payload, this.from, this.to);
			}
		} else {
			const at = this.from ?? editor.getCursor();
			const insertion = mode === "callout" ? `\n${payload}\n` : payload;
			editor.replaceRange(insertion, at);
		}
	}
}
