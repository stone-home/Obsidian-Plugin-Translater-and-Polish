import { App, type Editor, type PluginManifest } from 'obsidian';
import TranslatePolishPlugin from '../../src/main';
import { RewriteResult } from '../../src/response-parser';
import { TranslationBackend } from '../../src/translation-backend';
import { asStub } from './narrow';
import { Editor as StubEditor, Plugin as StubPlugin } from './obsidian-stub';

export const TRANSLATION_REPLY = 'Direct text.';
export const REWRITE_REPLY = '### NATIVE\nNative text.\n### SUGGESTIONS\n- tighten it';

export function rewrite(partial: Partial<RewriteResult> = {}): RewriteResult {
	return {
		nativeRewrite: 'Native text.',
		suggestions: ['tighten it'],
		raw: REWRITE_REPLY,
		...partial,
	};
}

/** The real Plugin constructor needs a full manifest; src/ does not read it. */
function testManifest(): PluginManifest {
	return {
		id: 'translate-polish',
		name: 'Translate and Polish',
		author: 'test',
		version: '0.0.0',
		minAppVersion: '0.0.0',
		description: 'test manifest',
	};
}

export async function makePlugin(seed?: unknown): Promise<TranslatePolishPlugin> {
	const app = new App();
	const plugin = new TranslatePolishPlugin(app, testManifest());
	if (seed !== undefined) asStub(plugin, StubPlugin).seedData(seed);
	await plugin.onload();
	return plugin;
}

/**
 * Mocks the backend so the translate task returns `translation` and the rewrite
 * task returns `rewriteReply`. Routing is by system prompt: the rewrite prompt
 * always carries the ### NATIVE marker.
 */
export function mockBackend(
	plugin: TranslatePolishPlugin,
	translation: string | Error = TRANSLATION_REPLY,
	rewriteReply: string | Error = REWRITE_REPLY
): jest.SpiedFunction<TranslationBackend['complete']> {
	return jest
		.spyOn(plugin.getBackend(), 'complete')
		.mockImplementation(async (systemPrompt: string) => {
			const reply = systemPrompt.includes('### NATIVE')
				? rewriteReply
				: translation;
			if (reply instanceof Error) throw reply;
			return reply;
		});
}

/** Editor with `text`, selecting the given range. */
export function editorWithSelection(
	text: string,
	from: { line: number; ch: number },
	to: { line: number; ch: number }
): Editor {
	const editor = new StubEditor(text);
	editor.setSelection(from, to);
	return editor;
}

export function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
