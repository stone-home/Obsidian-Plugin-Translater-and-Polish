import { Editor, EditorPosition, EventRef, Notice, Scope, setIcon } from "obsidian";
import type TranslatePolishPlugin from "./main";
import { RewriteResult } from "./response-parser";
import { TranslateModal } from "./translate-modal";
import { runRewrite, runTranslate } from "./translation-job";

type Variant = "direct" | "native";

export interface PopoverAnchor {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

const GAP = 6;
const MARGIN = 8;

/**
 * Read-only bubble anchored next to the selection. Shows the translation first;
 * the native rewrite is requested only when the user switches to it. Only one
 * is open at a time; Esc, clicking outside, scrolling or switching leaves closes it.
 */
export class QuickTranslatePopover {
	private static current: QuickTranslatePopover | undefined;

	static open(
		plugin: TranslatePolishPlugin,
		editor: Editor,
		from: EditorPosition,
		to: EditorPosition,
		text: string,
		anchor: PopoverAnchor,
	): QuickTranslatePopover {
		QuickTranslatePopover.current?.close();
		const popover = new QuickTranslatePopover(plugin, editor, from, to, text, anchor);
		QuickTranslatePopover.current = popover;
		popover.mount();
		return popover;
	}

	static closeCurrent(): void {
		QuickTranslatePopover.current?.close();
	}

	private readonly el: HTMLElement;
	private readonly scope: Scope;
	private bodyEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private variantSelect!: HTMLSelectElement;
	private translation: string | undefined;
	private rewrite: RewriteResult | undefined;
	private rewriteRequested = false;
	private variant: Variant = "direct";
	private seq = 0;
	private leafRef: EventRef | undefined;
	private readonly doc: Document;
	private closed = false;

	private readonly onMouseDown = (evt: MouseEvent): void => {
		if (!this.isInside(evt.target)) {
			this.close();
		}
	};
	private readonly onScroll = (evt: Event): void => {
		if (this.isInside(evt.target)) return;
		this.close();
	};
	private readonly onResize = (): void => this.close();

	/** Popout windows have their own Node class, so use Obsidian's cross-window check. */
	private isInside(target: EventTarget | null): boolean {
		const node = target as Node | null;
		return !!node && typeof node.instanceOf === "function" && node.instanceOf(Node) && this.el.contains(node);
	}

	private constructor(
		private readonly plugin: TranslatePolishPlugin,
		private readonly editor: Editor,
		private readonly from: EditorPosition,
		private readonly to: EditorPosition,
		private readonly text: string,
		private readonly anchor: PopoverAnchor,
	) {
		this.doc = activeDocument;
		this.el = this.doc.body.createDiv({ cls: "translate-popover" });
		this.scope = new Scope(plugin.app.scope);
		this.scope.register([], "Escape", () => {
			this.close();
			return false;
		});
	}

	private mount(): void {
		const header = this.el.createDiv({ cls: "translate-popover-header" });
		header.createSpan({
			cls: "translate-popover-langs",
			text: `${this.plugin.settings.defaultSourceLang} → ${this.plugin.settings.defaultTargetLang}`,
		});
		this.variantSelect = header.createEl("select", { cls: "dropdown translate-popover-variant" });
		this.variantSelect.createEl("option", { value: "direct", text: "Translation" });
		this.variantSelect.createEl("option", { value: "native", text: "Native rewrite" });
		this.variantSelect.addEventListener("change", () => {
			this.variant = this.variantSelect.value as Variant;
			this.renderBody();
			if (this.variant === "native" && !this.rewriteRequested) {
				void this.runRewrite();
			}
		});

		header.createDiv({ cls: "translate-modal-spacer" });
		this.iconButton(header, "copy", "Copy", () => {
			const value = this.currentText();
			if (!value) return;
			void navigator.clipboard.writeText(value).then(() => new Notice("Copied to clipboard."));
		});
		this.iconButton(header, "maximize-2", "Open in translate window", () => {
			this.close();
			new TranslateModal(this.plugin.app, this.plugin, this.editor, this.from, this.to, this.text).open();
		});
		this.iconButton(header, "x", "Close", () => this.close());

		this.bodyEl = this.el.createDiv({ cls: "translate-popover-body" });
		this.statusEl = this.el.createDiv({ cls: "translate-popover-status", text: "Translating…" });

		this.plugin.app.keymap.pushScope(this.scope);
		this.doc.addEventListener("mousedown", this.onMouseDown, true);
		this.doc.addEventListener("scroll", this.onScroll, true);
		activeWindow.addEventListener("resize", this.onResize);
		this.leafRef = this.plugin.app.workspace.on("active-leaf-change", () => this.close());

		this.position();
		void this.runTranslate();
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const button = parent.createEl("button", { cls: "clickable-icon translate-modal-icon", attr: { "aria-label": label } });
		setIcon(button, icon);
		button.addEventListener("click", onClick);
	}

	private input() {
		return {
			sourceText: this.text,
			sourceLang: this.plugin.settings.defaultSourceLang,
			targetLang: this.plugin.settings.defaultTargetLang,
		};
	}

	private signal() {
		const my = ++this.seq;
		return { isStale: () => my !== this.seq || this.closed };
	}

	private async runTranslate(): Promise<void> {
		await runTranslate(
			this.plugin,
			this.input(),
			{
				onStatus: (message) => this.showStatus(message, false),
				onResult: (translation) => {
					this.translation = translation;
					this.statusEl.hide();
					this.renderBody();
					this.position();
				},
				onError: (message) => {
					this.renderBody();
					this.showStatus(message, true);
				},
			},
			this.signal(),
		);
	}

	private async runRewrite(): Promise<void> {
		this.rewriteRequested = true;
		await runRewrite(
			this.plugin,
			this.input(),
			{
				onStatus: (message) => this.showStatus(message, false),
				onResult: (rewrite) => {
					this.rewrite = rewrite;
					this.statusEl.hide();
					this.renderBody();
					this.position();
				},
				onError: (message) => {
					this.renderBody();
					this.showStatus(message, true);
				},
			},
			this.signal(),
		);
	}

	private showStatus(message: string, isError: boolean): void {
		this.statusEl.setText(message);
		this.statusEl.toggleClass("is-error", isError);
		this.statusEl.show();
		this.position();
	}

	private currentText(): string {
		return this.variant === "native" ? (this.rewrite?.nativeRewrite ?? "") : (this.translation ?? "");
	}

	private renderBody(): void {
		this.bodyEl.setText(this.currentText() || "—");
	}

	private position(): void {
		const vw = activeWindow.innerWidth;
		const vh = activeWindow.innerHeight;
		const width = this.el.offsetWidth;
		const height = this.el.offsetHeight;
		let left = Math.min(Math.max(this.anchor.left, MARGIN), vw - width - MARGIN);
		let top = this.anchor.bottom + GAP;
		if (top + height > vh - MARGIN) {
			top = this.anchor.top - height - GAP;
		}
		if (top < MARGIN) top = MARGIN;
		if (left < MARGIN) left = MARGIN;
		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.seq += 1;
		this.plugin.app.keymap.popScope(this.scope);
		this.doc.removeEventListener("mousedown", this.onMouseDown, true);
		this.doc.removeEventListener("scroll", this.onScroll, true);
		activeWindow.removeEventListener("resize", this.onResize);
		if (this.leafRef) this.plugin.app.workspace.offref(this.leafRef);
		this.el.remove();
		if (QuickTranslatePopover.current === this) {
			QuickTranslatePopover.current = undefined;
		}
	}
}
