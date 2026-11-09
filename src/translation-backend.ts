import { requestUrl } from "obsidian";
import { DEFAULT_SETTINGS } from "./defaults";
import { ProviderId, buildHeaders, chatUrl, mapModelsResponse, modelsUrl } from "./providers";

export interface ProviderRequest {
	provider: ProviderId;
	baseUrl: string;
	apiKey: string;
	extraHeadersRaw: string;
	timeoutMs: number;
	/** When true, debug logs are printed to the console. */
	debug?: boolean;
}

export interface CompletionRequest extends ProviderRequest {
	model: string;
}

export interface TranslationBackend {
	/** Sends one system + user message pair and returns the assistant text. */
	complete(systemPrompt: string, userText: string, request: CompletionRequest): Promise<string>;
	listModels(request: ProviderRequest): Promise<string[]>;
}

export function createDefaultBackend(): TranslationBackend {
	return new HttpTranslationBackend();
}

/** Substitutes language placeholders; `auto` becomes a phrase the model can act on. */
export function renderPrompt(template: string, sourceLang: string, targetLang: string): string {
	const source = sourceLang || DEFAULT_SETTINGS.defaultSourceLang;
	const effectiveSource = source === "auto" ? "the language of the text" : source;
	const effectiveTarget = targetLang || DEFAULT_SETTINGS.defaultTargetLang;
	return template.replace(/{{sourceLang}}/g, effectiveSource).replace(/{{targetLang}}/g, effectiveTarget);
}

/** Rejects with a "timeout" error when `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	if (!Number.isFinite(ms) || ms <= 0) return promise;
	let timer: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new Error(`Request timeout after ${ms} ms`)), ms);
	});
	// Once the timeout wins, nobody awaits the original promise; keep its rejection from surfacing.
	promise.catch(() => undefined);
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== undefined) window.clearTimeout(timer);
	});
}

function debugLog(request: ProviderRequest, ...args: unknown[]): void {
	if (request.debug) {
		console.log("[translate-polish]", ...args);
	}
}

/** `response.json` parses lazily and throws on non-JSON bodies (e.g. a proxy's HTML page). */
function parseJsonBody(response: { status: number; text: string; json: unknown }): unknown {
	try {
		return response.json;
	} catch {
		throw new Error(`HTTP ${response.status}: response was not JSON (${(response.text || "").trim().slice(0, 120)})`);
	}
}

function httpError(status: number, body: string): Error {
	const snippet = (body || "").trim().slice(0, 300);
	return new Error(`HTTP ${status}${snippet ? `: ${snippet}` : ""}`);
}

export class HttpTranslationBackend implements TranslationBackend {
	async complete(systemPrompt: string, userText: string, request: CompletionRequest): Promise<string> {
		const url = chatUrl(request.provider, request.baseUrl);
		const messages = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userText },
		];
		const body =
			request.provider === "ollama"
				? { model: request.model, messages, stream: false, options: { temperature: 0.2 } }
				: { model: request.model, messages, temperature: 0.2 };

		debugLog(request, "POST →", url, "model:", request.model);

		const response = await withTimeout(
			requestUrl({
				url,
				method: "POST",
				contentType: "application/json",
				body: JSON.stringify(body),
				headers: buildHeaders(request.provider, request.apiKey, request.extraHeadersRaw),
				throw: false,
			}),
			request.timeoutMs,
		);

		debugLog(request, "Response status:", response.status);

		if (response.status < 200 || response.status >= 300) {
			throw httpError(response.status, response.text);
		}

		const content = extractContent(request.provider, parseJsonBody(response));
		if (!content) {
			debugLog(request, "Unexpected response shape:", response.text);
			throw new Error("No content in model response.");
		}
		return content;
	}

	async listModels(request: ProviderRequest): Promise<string[]> {
		const url = modelsUrl(request.provider, request.baseUrl);
		debugLog(request, "GET →", url);
		const response = await withTimeout(
			requestUrl({
				url,
				method: "GET",
				headers: buildHeaders(request.provider, request.apiKey, request.extraHeadersRaw),
				throw: false,
			}),
			request.timeoutMs,
		);
		if (response.status < 200 || response.status >= 300) {
			throw httpError(response.status, response.text);
		}
		return mapModelsResponse(request.provider, parseJsonBody(response));
	}
}

function extractContent(provider: ProviderId, json: unknown): string | undefined {
	if (!json || typeof json !== "object") return undefined;
	if (provider === "ollama") {
		const data = json as { message?: { content?: unknown } };
		const content = data.message?.content;
		return typeof content === "string" ? content.trim() : undefined;
	}
	const data = json as { choices?: Array<{ message?: { content?: unknown } }> };
	const content = data.choices?.[0]?.message?.content;
	return typeof content === "string" ? content.trim() : undefined;
}
