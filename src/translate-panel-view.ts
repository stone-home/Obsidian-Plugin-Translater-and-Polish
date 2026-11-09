import { ItemView, WorkspaceLeaf } from "obsidian";
import type TranslateBlockPlugin from "./main";
import { mountTranslateWorkspace, TranslateWorkspaceHandle } from "./translate-workspace";

export const VIEW_TYPE_TRANSLATE_PANEL = "translate-panel";

export class TranslatePanelView extends ItemView {
	plugin: TranslateBlockPlugin;
	private workspaceHandle: TranslateWorkspaceHandle | undefined;
	private readonly panelWorkspaceId = `translate-panel:${Date.now().toString(36)}`;

	constructor(leaf: WorkspaceLeaf, plugin: TranslateBlockPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TRANSLATE_PANEL;
	}

	getDisplayText(): string {
		return "Translate";
	}

	getIcon(): string {
		return "languages";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("translate-panel-view");

		this.workspaceHandle = mountTranslateWorkspace(contentEl, this.plugin.getWorkspaceHost(), {
			id: this.panelWorkspaceId,
			initialSourceText: "",
			initialSourceLang: this.plugin.settings.defaultSourceLang,
			initialTargetLang: this.plugin.settings.defaultTargetLang,
			initialModel: this.plugin.getActiveProvider().config.selectedModel,
			prompt: this.plugin.settings.defaultPrompt,
			containerClass: "translate-panel-container",
		});
	}

	async onClose(): Promise<void> {
		if (this.workspaceHandle) {
			this.plugin.unregisterWorkspace(this.workspaceHandle.id);
			this.workspaceHandle.destroy();
			this.workspaceHandle = undefined;
		}
		this.contentEl.empty();
	}

	refreshModelOptions(): void {
		this.workspaceHandle?.refreshModelOptions();
	}
}
