/**
 * Provider catalogue: ids, defaults, URL builders, header builders and
 * model-list response mappers. Pure module (no `obsidian` import) so it can be
 * unit-tested.
 */

export type ProviderId = "ollama" | "openrouter" | "openwebui";

export const PROVIDER_IDS: readonly ProviderId[] = ["ollama", "openrouter", "openwebui"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
	ollama: "Ollama",
	openrouter: "OpenRouter",
	openwebui: "Open WebUI",
};

export interface ProviderConfig {
	/** Origin (plus optional path prefix) of the API, without the endpoint path. */
	baseUrl: string;
	/** Models available in dropdowns (filled by "Fetch models"). */
	models: string[];
	/** Extra HTTP headers, one `Key: Value` per line. */
	extraHeadersRaw: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderConfig> = {
	ollama: {
		baseUrl: "http://localhost:13434",
		models: ["llama3"],
		extraHeadersRaw: "",
	},
	openrouter: {
		baseUrl: "https://openrouter.ai",
		models: [],
		extraHeadersRaw: "",
	},
	openwebui: {
		baseUrl: "http://localhost:3000",
		models: [],
		extraHeadersRaw: "",
	},
};

/** Whether the provider expects a Bearer API key. */
export function providerUsesApiKey(id: ProviderId): boolean {
	return id !== "ollama";
}

/** Whether the provider's base URL is user-configurable. */
export function providerHasBaseUrl(id: ProviderId): boolean {
	return id !== "openrouter";
}

export function cloneProviderConfig(config: ProviderConfig): ProviderConfig {
	return {
		baseUrl: config.baseUrl,
		models: [...config.models],
		extraHeadersRaw: config.extraHeadersRaw,
	};
}

export function normalizeBaseUrl(id: ProviderId, baseUrl: string): string {
	const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
	return trimmed || PROVIDER_DEFAULTS[id].baseUrl;
}

export function chatUrl(id: ProviderId, baseUrl: string): string {
	const base = normalizeBaseUrl(id, baseUrl);
	switch (id) {
		case "ollama":
			return `${base}/api/chat`;
		case "openwebui":
			return `${base}/api/chat/completions`;
		case "openrouter":
			return `${base}/api/v1/chat/completions`;
	}
}

export function modelsUrl(id: ProviderId, baseUrl: string): string {
	const base = normalizeBaseUrl(id, baseUrl);
	switch (id) {
		case "ollama":
			return `${base}/api/tags`;
		case "openwebui":
			return `${base}/api/models`;
		case "openrouter":
			return `${base}/api/v1/models`;
	}
}

/** Storage id for the provider's API key in `app.secretStorage`. */
export function secretId(id: ProviderId): string {
	return `translate-polish-${id}-api-key`;
}

/**
 * Parses `Key: Value` lines into a header map. Blank lines and lines without a
 * colon are ignored.
 */
export function parseHeaderLines(raw: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const rawLine of (raw || "").split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (!key || !value) continue;
		headers[key] = value;
	}
	return headers;
}

export const OPENROUTER_REFERER = "https://github.com/stone-home/Obsidian-Plugin-Translate-Code-Block";
export const OPENROUTER_TITLE = "Translate and Polish";

/**
 * Builds request headers: Bearer auth when a key is present, OpenRouter
 * attribution headers, then user-supplied headers (which win on conflict).
 */
export function buildHeaders(id: ProviderId, apiKey: string, extraHeadersRaw: string): Record<string, string> {
	const headers: Record<string, string> = {};
	const key = (apiKey || "").trim();
	if (key) {
		headers["Authorization"] = `Bearer ${key}`;
	}
	if (id === "openrouter") {
		headers["HTTP-Referer"] = OPENROUTER_REFERER;
		headers["X-Title"] = OPENROUTER_TITLE;
	}
	const extra = parseHeaderLines(extraHeadersRaw);
	for (const name of Object.keys(extra)) {
		headers[name] = extra[name];
	}
	return headers;
}

function collectStrings(items: unknown, field: string): string[] {
	if (!Array.isArray(items)) return [];
	const out: string[] = [];
	for (const item of items) {
		if (item && typeof item === "object") {
			const value = (item as Record<string, unknown>)[field];
			if (typeof value === "string" && value.trim()) {
				out.push(value.trim());
			}
		}
	}
	return out;
}

/**
 * Maps a provider's model-list response to a sorted, de-duplicated list of
 * model ids. Returns `[]` for malformed input.
 */
export function mapModelsResponse(id: ProviderId, json: unknown): string[] {
	if (!json || typeof json !== "object") return [];
	const data = json as Record<string, unknown>;
	let names: string[];
	switch (id) {
		case "ollama":
			names = collectStrings(data.models, "name");
			break;
		case "openwebui":
		case "openrouter":
			names = collectStrings(data.data, "id");
			break;
	}
	const unique = Array.from(new Set(names));
	unique.sort((a, b) => a.localeCompare(b));
	return unique;
}
