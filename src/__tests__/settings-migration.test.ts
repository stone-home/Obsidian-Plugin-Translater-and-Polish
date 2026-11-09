import { DEFAULT_REWRITE_PROMPT, DEFAULT_TRANSLATE_PROMPT, LEGACY_DEFAULT_PROMPT, SETTINGS_VERSION, V2_DEFAULT_PROMPTS } from "../defaults";
import { extractBearerKey, legacyEndpointToBaseUrl, migrateSettings } from "../settings-migration";

describe("migrateSettings", () => {
	it("returns defaults for an empty store without flagging a migration", () => {
		const { settings, migrated, legacyApiKey } = migrateSettings(null);
		expect(migrated).toBe(false);
		expect(legacyApiKey).toBeUndefined();
		expect(settings.settingsVersion).toBe(SETTINGS_VERSION);
		expect(settings.tasks).toEqual({
			translate: { provider: "ollama", model: "llama3" },
			rewrite: { provider: "ollama", model: "llama3" },
		});
	});

	it("migrates a 1.x store into the Ollama provider and both tasks", () => {
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
			extraHeadersRaw: "X-Proxy: yes",
		});
		expect(settings.tasks.translate).toEqual({ provider: "ollama", model: "llama3" });
		expect(settings.tasks.rewrite).toEqual({ provider: "ollama", model: "llama3" });
		expect(settings.translatePrompt).toBe(DEFAULT_TRANSLATE_PROMPT);
		expect(settings.rewritePrompt).toBe(DEFAULT_REWRITE_PROMPT);
		expect(settings.defaultSourceLang).toBe("zh");
		expect(settings.maxAttempts).toBe(5);
		expect(settings.debug).toBe(true);
		const asRecord = settings as unknown as Record<string, unknown>;
		expect(asRecord.pollIntervalMs).toBeUndefined();
		expect(asRecord.endpointUrl).toBeUndefined();
		expect(asRecord.activeProvider).toBeUndefined();
	});

	it("keeps a customised legacy prompt as the translation prompt", () => {
		const { settings } = migrateSettings({ defaultPrompt: "Translate like a pirate." });
		expect(settings.translatePrompt).toBe("Translate like a pirate.");
	});

	it("migrates the v2 pre-release shape to task bindings", () => {
		const v2 = {
			settingsVersion: 2,
			activeProvider: "openrouter",
			providers: {
				ollama: { baseUrl: "http://o", models: ["llama3"], selectedModel: "llama3" },
				openrouter: { baseUrl: "https://openrouter.ai", models: ["a/b", "c/d"], selectedModel: "c/d" },
			},
			defaultPrompt: V2_DEFAULT_PROMPTS[1],
			liveDelayMs: 500,
		};
		const { settings, migrated } = migrateSettings(v2);
		expect(migrated).toBe(true);
		expect(settings.tasks.translate).toEqual({ provider: "openrouter", model: "c/d" });
		expect(settings.tasks.rewrite).toEqual({ provider: "openrouter", model: "c/d" });
		expect(settings.providers.openrouter.models).toEqual(["a/b", "c/d"]);
		expect(settings.translatePrompt).toBe(DEFAULT_TRANSLATE_PROMPT);
		expect(settings.liveDelayMs).toBe(500);

		const custom = migrateSettings({ settingsVersion: 2, activeProvider: "bogus", defaultPrompt: "Mine" }).settings;
		expect(custom.tasks.translate).toEqual({ provider: "ollama", model: "llama3" });
		expect(custom.translatePrompt).toBe("Mine");
	});

	it("is idempotent for a current-version store and repairs missing fields", () => {
		const first = migrateSettings({ endpointUrl: "http://localhost:13434/api/chat", modelsRaw: "llama3" }).settings;
		const second = migrateSettings(JSON.parse(JSON.stringify(first)));
		expect(second.migrated).toBe(false);
		expect(second.settings).toEqual(first);

		const damaged = migrateSettings({
			settingsVersion: SETTINGS_VERSION,
			providers: { openrouter: { models: ["x/y", "a/b"] } },
			tasks: { translate: { provider: "nope", model: " m " } },
			translatePrompt: DEFAULT_TRANSLATE_PROMPT,
			rewritePrompt: "Custom rewrite",
		}).settings;
		expect(damaged.tasks.translate).toEqual({ provider: "ollama", model: "m" });
		expect(damaged.tasks.rewrite).toEqual({ provider: "ollama", model: "llama3" });
		expect(damaged.providers.openrouter.baseUrl).toBe("https://openrouter.ai");
		expect(damaged.providers.openwebui.baseUrl).toBe("http://localhost:3000");
		expect(damaged.rewritePrompt).toBe("Custom rewrite");
	});

	it("treats a newer settingsVersion as current instead of re-migrating", () => {
		const { settings, migrated } = migrateSettings({
			settingsVersion: SETTINGS_VERSION + 1,
			tasks: { translate: { provider: "openwebui", model: "m" } },
			providers: { openwebui: { baseUrl: "http://x:8080", models: ["m"] } },
		});
		expect(migrated).toBe(false);
		expect(settings.tasks.translate).toEqual({ provider: "openwebui", model: "m" });
		expect(settings.providers.openwebui.baseUrl).toBe("http://x:8080");
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
