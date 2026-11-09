import type TranslateBlockPlugin from "./main";
import { resolveModel } from "./models";
import { PROVIDER_LABELS } from "./providers";
import { StructuredTranslation } from "./response-parser";

export interface TranslationJobInput {
	sourceText: string;
	sourceLang: string;
	targetLang: string;
	/** Overrides the active provider's selected model when set. */
	model?: string;
	/** Overrides the default prompt when set. */
	prompt?: string;
}

export interface TranslationJobCallbacks {
	onStatus(message: string): void;
	onResult(result: StructuredTranslation): void;
	onError(message: string): void;
}

/** Lets a caller discard results of a request that has been superseded. */
export interface StaleSignal {
	isStale(): boolean;
}

export function isSoftErrorMessage(message: string): boolean {
	const lower = message.toLowerCase();
	if (lower.includes("timeout") || lower.includes("network")) return true;
	return /\b50[0234]\b/.test(lower);
}

const RETRY_DELAY_MS = 300;

/**
 * Runs one translation against the active provider with the plugin's retry,
 * size and model rules. Callbacks are skipped once `signal.isStale()` is true.
 * Resolves to the result, or `undefined` when nothing was delivered.
 */
export async function runTranslationJob(
	plugin: TranslateBlockPlugin,
	input: TranslationJobInput,
	callbacks: TranslationJobCallbacks,
	signal?: StaleSignal,
): Promise<StructuredTranslation | undefined> {
	const stale = (): boolean => signal?.isStale() ?? false;
	const text = input.sourceText;

	if (text.trim().length === 0) {
		callbacks.onError("No source text to translate.");
		return undefined;
	}
	if (text.length > plugin.settings.maxChars) {
		callbacks.onError(
			`Text too long (${text.length} chars). Reduce it or raise the max text size in settings.`,
		);
		return undefined;
	}

	const { id: providerId, config } = plugin.getActiveProvider();
	const wanted = input.model ?? config.selectedModel;
	const model = config.models.length > 0 ? resolveModel(config.models, wanted) : wanted;
	if (!model) {
		callbacks.onError(`No model selected for ${PROVIDER_LABELS[providerId]}. Fetch models in settings.`);
		return undefined;
	}

	const backend = plugin.getBackend();
	const request = {
		...plugin.buildProviderRequest(providerId),
		model,
		prompt: input.prompt ?? plugin.settings.defaultPrompt,
	};
	const maxAttempts = Math.max(1, plugin.settings.maxAttempts);
	let lastError = "Unknown error";

	callbacks.onStatus("Translating…");

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const result = await backend.translate(text, input.sourceLang, input.targetLang, request);
			if (stale()) return undefined;
			callbacks.onResult(result);
			return result;
		} catch (error) {
			if (stale()) return undefined;
			lastError = error instanceof Error ? error.message : String(error);
			if (!isSoftErrorMessage(lastError) || attempt >= maxAttempts) break;
			callbacks.onStatus(`Retrying (${attempt + 1}/${maxAttempts})…`);
			await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
			if (stale()) return undefined;
		}
	}

	callbacks.onError(`Translation failed: ${lastError}`);
	return undefined;
}
