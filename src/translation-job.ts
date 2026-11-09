import { TASK_LABELS, TaskId } from "./defaults";
import type TranslatePolishPlugin from "./main";
import { PROVIDER_LABELS } from "./providers";
import {
	REWRITE_PROMPT_SUFFIX,
	RewriteResult,
	SECTION_MARKERS,
	parseRewriteResponse,
	parseTranslationResponse,
} from "./response-parser";
import { renderPrompt } from "./translation-backend";

export interface TaskInput {
	sourceText: string;
	sourceLang: string;
	targetLang: string;
}

export interface TaskCallbacks<T> {
	onStatus(message: string): void;
	onResult(result: T): void;
	onError(message: string): void;
}

/** Lets a caller discard results of a request that has been superseded. */
export interface StaleSignal {
	isStale(): boolean;
}

export function isSoftErrorMessage(message: string): boolean {
	const lower = message.toLowerCase();
	if (lower.includes("timeout") || lower.includes("network")) return true;
	if (/net::|err_|econn|etimedout|fetch failed|socket hang up/.test(lower)) return true;
	return /\b50[0234]\b/.test(lower);
}

const RETRY_DELAY_MS = 300;

/** System prompt for a task, with the rewrite format appended when the user's prompt lacks it. */
export function buildTaskPrompt(plugin: TranslatePolishPlugin, task: TaskId, input: TaskInput): string {
	if (task === "translate") {
		return renderPrompt(plugin.settings.translatePrompt.trim(), input.sourceLang, input.targetLang);
	}
	let template = plugin.settings.rewritePrompt.trim();
	if (!template.toUpperCase().includes(SECTION_MARKERS.native)) {
		template = `${template}\n\n${REWRITE_PROMPT_SUFFIX}`;
	}
	return renderPrompt(template, input.sourceLang, input.targetLang);
}

/**
 * Runs one task against its bound provider/model with the plugin's retry and
 * size rules. Callbacks are skipped once `signal.isStale()` is true.
 * Resolves to the raw assistant text, or `undefined` when nothing was delivered.
 */
export async function runTask(
	plugin: TranslatePolishPlugin,
	task: TaskId,
	input: TaskInput,
	callbacks: TaskCallbacks<string>,
	signal?: StaleSignal,
): Promise<string | undefined> {
	const stale = (): boolean => signal?.isStale() ?? false;
	const text = input.sourceText;

	if (text.trim().length === 0) {
		callbacks.onError("No source text.");
		return undefined;
	}
	if (text.length > plugin.settings.maxChars) {
		callbacks.onError(`Text too long (${text.length} chars). Reduce it or raise the max text size in settings.`);
		return undefined;
	}

	const binding = plugin.settings.tasks[task];
	if (!binding.model) {
		callbacks.onError(
			`No model chosen for ${TASK_LABELS[task].toLowerCase()} (${PROVIDER_LABELS[binding.provider]}). Pick one in settings.`,
		);
		return undefined;
	}

	const backend = plugin.getBackend();
	const request = { ...plugin.buildProviderRequest(binding.provider), model: binding.model };
	const systemPrompt = buildTaskPrompt(plugin, task, input);
	const maxAttempts = Math.max(1, plugin.settings.maxAttempts);
	let lastError = "Unknown error";

	callbacks.onStatus(task === "translate" ? "Translating…" : "Rewriting…");

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const reply = await backend.complete(systemPrompt, text, request);
			if (stale()) return undefined;
			callbacks.onResult(reply);
			return reply;
		} catch (error) {
			if (stale()) return undefined;
			lastError = error instanceof Error ? error.message : String(error);
			if (!isSoftErrorMessage(lastError) || attempt >= maxAttempts) break;
			callbacks.onStatus(`Retrying (${attempt + 1}/${maxAttempts})…`);
			await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
			if (stale()) return undefined;
		}
	}

	callbacks.onError(`${TASK_LABELS[task]} failed: ${lastError}`);
	return undefined;
}

/** Translation task with the reply parsed to plain text. */
export function runTranslate(
	plugin: TranslatePolishPlugin,
	input: TaskInput,
	callbacks: TaskCallbacks<string>,
	signal?: StaleSignal,
): Promise<string | undefined> {
	return runTask(
		plugin,
		"translate",
		input,
		{ ...callbacks, onResult: (reply) => callbacks.onResult(parseTranslationResponse(reply)) },
		signal,
	).then((reply) => (reply === undefined ? undefined : parseTranslationResponse(reply)));
}

/** Rewrite task with the reply parsed into rewrite + suggestions. */
export function runRewrite(
	plugin: TranslatePolishPlugin,
	input: TaskInput,
	callbacks: TaskCallbacks<RewriteResult>,
	signal?: StaleSignal,
): Promise<RewriteResult | undefined> {
	return runTask(
		plugin,
		"rewrite",
		input,
		{ ...callbacks, onResult: (reply) => callbacks.onResult(parseRewriteResponse(reply)) },
		signal,
	).then((reply) => (reply === undefined ? undefined : parseRewriteResponse(reply)));
}
