import {
	DEFAULT_REWRITE_PROMPT,
	DEFAULT_TRANSLATE_PROMPT,
	LEGACY_DEFAULT_PROMPT,
	SETTINGS_VERSION,
	TASK_IDS,
	TaskBinding,
	TaskId,
	TranslateBlockSettings,
	V2_DEFAULT_PROMPTS,
	freshDefaultSettings,
} from "./defaults";
import { resolveLanguage } from "./languages";
import { parseModelList, resolveModel } from "./models";
import { PROVIDER_DEFAULTS, PROVIDER_IDS, ProviderConfig, ProviderId, normalizeBaseUrl } from "./providers";

export interface MigrationResult {
	settings: TranslateBlockSettings;
	/** API key lifted out of a legacy `Authorization: Bearer …` header, to be stored as a secret. */
	legacyApiKey?: string;
	/** True when the stored shape changed and should be saved back. */
	migrated: boolean;
}

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function str(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function isProviderId(value: unknown): value is ProviderId {
	return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function cleanModelList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	return Array.from(
		new Set(
			(value as unknown[])
				.filter((m): m is string => typeof m === "string")
				.map((m) => m.trim())
				.filter((m) => m.length > 0),
		),
	);
}

/** Ensures a provider config has every field. */
export function normalizeProviderConfig(id: ProviderId, input: unknown): ProviderConfig {
	const raw = asObject(input);
	const defaults = PROVIDER_DEFAULTS[id];
	return {
		baseUrl: normalizeBaseUrl(id, str(raw.baseUrl, defaults.baseUrl)),
		models: cleanModelList(raw.models, defaults.models),
		extraHeadersRaw: str(raw.extraHeadersRaw, defaults.extraHeadersRaw),
	};
}

function normalizeTask(input: unknown, fallback: TaskBinding): TaskBinding {
	const raw = asObject(input);
	return {
		provider: isProviderId(raw.provider) ? raw.provider : fallback.provider,
		model: str(raw.model, fallback.model).trim(),
	};
}

/** A prompt equal to any shipped default is treated as "unset" so new defaults apply. */
function isDefaultPrompt(prompt: string): boolean {
	const trimmed = prompt.trim();
	return (
		!trimmed ||
		trimmed === LEGACY_DEFAULT_PROMPT ||
		V2_DEFAULT_PROMPTS.includes(trimmed) ||
		trimmed === DEFAULT_TRANSLATE_PROMPT ||
		trimmed === DEFAULT_REWRITE_PROMPT
	);
}

/**
 * Pulls a `Authorization: Bearer <key>` line out of a header block.
 * Returns the remaining lines and the key, if any.
 */
export function extractBearerKey(extraHeadersRaw: string): { rest: string; apiKey?: string } {
	let apiKey: string | undefined;
	const kept: string[] = [];
	for (const line of (extraHeadersRaw || "").split("\n")) {
		const match = /^\s*authorization\s*:\s*bearer\s+(\S+)\s*$/i.exec(line);
		if (match && !apiKey) {
			apiKey = match[1];
			continue;
		}
		kept.push(line);
	}
	return { rest: kept.join("\n").trim(), apiKey };
}

/** Strips the 1.x Ollama endpoint path so only the origin remains. */
export function legacyEndpointToBaseUrl(endpointUrl: string): string {
	return (endpointUrl || "").trim().replace(/\/api\/chat\/?$/i, "");
}

function applyCommonFields(target: TranslateBlockSettings, raw: Raw): void {
	target.defaultSourceLang = resolveLanguage(str(raw.defaultSourceLang, ""), target.defaultSourceLang);
	target.defaultTargetLang = resolveLanguage(str(raw.defaultTargetLang, ""), target.defaultTargetLang);
	target.liveDelayMs = positiveInt(raw.liveDelayMs, target.liveDelayMs);
	target.maxAttempts = positiveInt(raw.maxAttempts, target.maxAttempts);
	target.timeoutMs = positiveInt(raw.timeoutMs, target.timeoutMs);
	target.maxChars = positiveInt(raw.maxChars, target.maxChars);
	target.debug = bool(raw.debug, target.debug);
}

function applyPrompts(target: TranslateBlockSettings, raw: Raw): void {
	const translate = str(raw.translatePrompt, "");
	const rewrite = str(raw.rewritePrompt, "");
	if (!isDefaultPrompt(translate)) target.translatePrompt = translate.trim();
	if (!isDefaultPrompt(rewrite)) target.rewritePrompt = rewrite.trim();
}

/**
 * Converts whatever is in data.json into the current settings shape.
 * Idempotent for current-version input.
 */
export function migrateSettings(data: unknown): MigrationResult {
	const raw = asObject(data);
	const settings = freshDefaultSettings();
	const version = typeof raw.settingsVersion === "number" ? raw.settingsVersion : 1;

	if (version >= SETTINGS_VERSION) {
		applyCommonFields(settings, raw);
		applyPrompts(settings, raw);
		const providers = asObject(raw.providers);
		for (const id of PROVIDER_IDS) {
			settings.providers[id] = normalizeProviderConfig(id, providers[id]);
		}
		const tasks = asObject(raw.tasks);
		for (const task of TASK_IDS) {
			settings.tasks[task] = normalizeTask(tasks[task], settings.tasks[task]);
		}
		return { settings, migrated: false };
	}

	applyCommonFields(settings, raw);

	if (version === 2) {
		// 2.0 pre-release shape: activeProvider + per-provider selectedModel + single defaultPrompt.
		const providers = asObject(raw.providers);
		for (const id of PROVIDER_IDS) {
			settings.providers[id] = normalizeProviderConfig(id, providers[id]);
		}
		const active = isProviderId(raw.activeProvider) ? raw.activeProvider : "ollama";
		const selected = str(asObject(providers[active]).selectedModel, "").trim();
		const model = selected || settings.providers[active].models[0] || "";
		for (const task of TASK_IDS) {
			settings.tasks[task] = { provider: active, model };
		}
		const prompt = str(raw.defaultPrompt, "");
		if (!isDefaultPrompt(prompt)) settings.translatePrompt = prompt.trim();
		return { settings, migrated: true };
	}

	// 1.x shape or empty store.
	const ollama = settings.providers.ollama;
	const endpoint = str(raw.endpointUrl, "");
	if (endpoint.trim()) {
		ollama.baseUrl = normalizeBaseUrl("ollama", legacyEndpointToBaseUrl(endpoint));
	}
	const modelsRaw = str(raw.modelsRaw, "");
	const defaultModel = str(raw.defaultModel, "");
	if (modelsRaw.trim() || defaultModel.trim()) {
		ollama.models = parseModelList(modelsRaw, defaultModel || PROVIDER_DEFAULTS.ollama.models[0]);
	}
	const model = resolveModel(ollama.models, defaultModel);
	settings.tasks.translate = { provider: "ollama", model };
	settings.tasks.rewrite = { provider: "ollama", model };
	const prompt = str(raw.defaultPrompt, "");
	if (!isDefaultPrompt(prompt)) settings.translatePrompt = prompt.trim();
	const { rest, apiKey } = extractBearerKey(str(raw.extraHeadersRaw, ""));
	ollama.extraHeadersRaw = rest;

	const migrated = Object.keys(raw).length > 0;
	return { settings, legacyApiKey: apiKey, migrated };
}
