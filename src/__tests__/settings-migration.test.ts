import { DEFAULT_PROMPT, LEGACY_DEFAULT_PROMPT, SETTINGS_VERSION } from "../defaults";
import { extractBearerKey, legacyEndpointToBaseUrl, migrateSettings } from "../settings-migration";

describe("migrateSettings", () => {
	it("returns defaults for an empty store without flagging a migration", () => {
		const { settings, migrated, legacyApiKey } = migrateSettings(null);
		expect(migrated).toBe(false);
		expect(legacyApiKey).toBeUndefined();
		expect(settings.settingsVersion).toBe(SETTINGS_VERSION);
		expect(settings.activeProvider).toBe("ollama");
		expect(settings.providers.ollama.models).toEqual(["llama3"]);
	});

	it("migrates a 1.x store into the Ollama provider", () => {
		const legacy = {
			endpointUrl: "http://10.0.0.5:11434/api/chat/",
			modelsRaw: "mistral\nllama3\n\nllama3",
			defaultModel: "llama3",
			defaultPrompt: LEGACY_DEFAULT_PROMPT,
			defaultSourceLang: "zh",
			defaultTargetLang: "en",
			pollIntervalMs: 1000,
			maxAttempts: 5,
			timeoutMs: 30000,
			maxChars: 2000,
			extraHeadersRaw: "Authorization: Bearer abc123\nX-Proxy: yes",
			debug: true,
		};
		const { settings, migrated, legacyApiKey } = migrateSettings(legacy);
		expect(migrated).toBe(true);
		expect(legacyApiKey).toBe("abc123");
		expect(settings.providers.ollama).toEqual({
			baseUrl: "http://10.0.0.5:11434",
			models: ["mistral", "llama3"],
			selectedModel: "llama3",
			extraHeadersRaw: "X-Proxy: yes",
		});
		expect(settings.defaultPrompt).toBe(DEFAULT_PROMPT);
		expect(settings.defaultSourceLang).toBe("zh");
		expect(settings.maxAttempts).toBe(5);
		expect(settings.timeoutMs).toBe(30000);
		expect(settings.maxChars).toBe(2000);
		expect(settings.debug).toBe(true);
		expect((settings as unknown as Record<string, unknown>).pollIntervalMs).toBeUndefined();
		expect((settings as unknown as Record<string, unknown>).endpointUrl).toBeUndefined();
	});

	it("keeps a customised legacy prompt", () => {
		const { settings } = migrateSettings({ defaultPrompt: "Translate like a pirate." });
		expect(settings.defaultPrompt).toBe("Translate like a pirate.");
	});

	it("is idempotent for a current-version store and repairs missing fields", () => {
		const first = migrateSettings({
			endpointUrl: "http://localhost:13434/api/chat",
			modelsRaw: "llama3",
		}).settings;
		const second = migrateSettings(JSON.parse(JSON.stringify(first)));
		expect(second.migrated).toBe(false);
		expect(second.settings).toEqual(first);

		const damaged = migrateSettings({
			settingsVersion: SETTINGS_VERSION,
			activeProvider: "bogus",
			providers: { openrouter: { models: ["x/y", "a/b"], selectedModel: "missing" } },
		}).settings;
		expect(damaged.activeProvider).toBe("ollama");
		expect(damaged.providers.openrouter.selectedModel).toBe("x/y");
		expect(damaged.providers.openrouter.baseUrl).toBe("https://openrouter.ai");
		expect(damaged.providers.openwebui.baseUrl).toBe("http://localhost:3000");
	});
});

describe("helpers", () => {
	it("extracts only the first Bearer header", () => {
		expect(extractBearerKey("A: 1\nAuthorization: Bearer k1\nauthorization: bearer k2")).toEqual({
			rest: "A: 1\nauthorization: bearer k2",
			apiKey: "k1",
		});
		expect(extractBearerKey("")).toEqual({ rest: "" });
	});

	it("strips the legacy /api/chat path", () => {
		expect(legacyEndpointToBaseUrl("http://localhost:13434/api/chat")).toBe("http://localhost:13434");
		expect(legacyEndpointToBaseUrl("http://host/API/CHAT/")).toBe("http://host");
		expect(legacyEndpointToBaseUrl("http://host:3000")).toBe("http://host:3000");
	});
});

describe("forward compatibility", () => {
	it("treats a newer settingsVersion as current instead of re-migrating", () => {
		const { settings, migrated } = migrateSettings({
			settingsVersion: SETTINGS_VERSION + 1,
			activeProvider: "openwebui",
			providers: { openwebui: { baseUrl: "http://x:8080", models: ["m"], selectedModel: "m" } },
		});
		expect(migrated).toBe(false);
		expect(settings.activeProvider).toBe("openwebui");
		expect(settings.providers.openwebui.baseUrl).toBe("http://x:8080");
	});
});
