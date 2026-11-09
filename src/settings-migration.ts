import {
	DEFAULT_PROMPT,
	LEGACY_DEFAULT_PROMPT,
	SETTINGS_VERSION,
	TranslateBlockSettings,
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

/** Ensures a provider config has every field and a selected model that exists in its list. */
export function normalizeProviderConfig(id: ProviderId, input: unknown): ProviderConfig {
	const raw = asObject(input);
	const defaults = PROVIDER_DEFAULTS[id];
	const models = Array.isArray(raw.models)
		? Array.from(
				new Set(
					(raw.models as unknown[])
						.filter((m): m is string => typeof m === "string")
						.map((m) => m.trim())
						.filter((m) => m.length > 0),
				),
			)
		: [...defaults.models];
	const wanted = str(raw.selectedModel, defaults.selectedModel).trim();
	const selectedModel = models.length > 0 ? resolveModel(models, wanted) : wanted;
	return {
		baseUrl: normalizeBaseUrl(id, str(raw.baseUrl, defaults.baseUrl)),
		models,
		selectedModel,
		extraHeadersRaw: str(raw.extraHeadersRaw, defaults.extraHeadersRaw),
	};
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
	const prompt = str(raw.defaultPrompt, DEFAULT_PROMPT).trim();
	target.defaultPrompt = !prompt || prompt === LEGACY_DEFAULT_PROMPT ? DEFAULT_PROMPT : prompt;
	target.defaultSourceLang = resolveLanguage(str(raw.defaultSourceLang, ""), target.defaultSourceLang);
	target.defaultTargetLang = resolveLanguage(str(raw.defaultTargetLang, ""), target.defaultTargetLang);
	target.liveDelayMs = positiveInt(raw.liveDelayMs, target.liveDelayMs);
	target.maxAttempts = positiveInt(raw.maxAttempts, target.maxAttempts);
	target.timeoutMs = positiveInt(raw.timeoutMs, target.timeoutMs);
	target.maxChars = positiveInt(raw.maxChars, target.maxChars);
	target.debug = bool(raw.debug, target.debug);
}

/**
 * Converts whatever is in data.json into the current settings shape.
 * Idempotent for current-version input.
 */
export function migrateSettings(data: unknown): MigrationResult {
	const raw = asObject(data);
	const settings = freshDefaultSettings();

	if (raw.settingsVersion === SETTINGS_VERSION) {
		applyCommonFields(settings, raw);
		settings.activeProvider = isProviderId(raw.activeProvider) ? raw.activeProvider : settings.activeProvider;
		const providers = asObject(raw.providers);
		for (const id of PROVIDER_IDS) {
			settings.providers[id] = normalizeProviderConfig(id, providers[id]);
		}
		return { settings, migrated: false };
	}

	// Legacy (1.x) shape or empty store.
	applyCommonFields(settings, raw);
	settings.activeProvider = "ollama";

	const ollama = settings.providers.ollama;
	const endpoint = str(raw.endpointUrl, "");
	if (endpoint.trim()) {
		ollama.baseUrl = normalizeBaseUrl("ollama", legacyEndpointToBaseUrl(endpoint));
	}
	const modelsRaw = str(raw.modelsRaw, "");
	const defaultModel = str(raw.defaultModel, "");
	if (modelsRaw.trim() || defaultModel.trim()) {
		ollama.models = parseModelList(modelsRaw, defaultModel || PROVIDER_DEFAULTS.ollama.selectedModel);
		ollama.selectedModel = resolveModel(ollama.models, defaultModel);
	}
	const { rest, apiKey } = extractBearerKey(str(raw.extraHeadersRaw, ""));
	ollama.extraHeadersRaw = rest;

	const migrated = Object.keys(raw).length > 0;
	return { settings, legacyApiKey: apiKey, migrated };
}
