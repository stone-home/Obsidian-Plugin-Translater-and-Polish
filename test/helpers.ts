import { App, Editor } from "obsidian";
import TranslateBlockPlugin from "../src/main";
import { StructuredTranslation } from "../src/response-parser";

export function result(partial: Partial<StructuredTranslation> = {}): StructuredTranslation {
	return {
		directTranslation: "Direct text.",
		nativeRewrite: "Native text.",
		suggestions: ["tighten it"],
		raw: "raw",
		...partial,
	};
}

export async function makePlugin(seed?: unknown): Promise<TranslateBlockPlugin> {
	const app = new App();
	const plugin = new TranslateBlockPlugin(app, { id: "obsidian-translate-block" } as any);
	if (seed !== undefined) (plugin as any).seedData(seed);
	await plugin.onload();
	return plugin;
}

/** Editor with `text`, selecting the given range. */
export function editorWithSelection(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }): Editor {
	const editor = new Editor(text);
	editor.setSelection(from, to);
	return editor;
}

export function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
