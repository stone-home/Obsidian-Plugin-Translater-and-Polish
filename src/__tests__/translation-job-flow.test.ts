import { runTranslationJob } from "../translation-job";
import { result } from "../../test/helpers";

function fakePlugin(overrides: Partial<any> = {}) {
	const translate = jest.fn();
	const plugin: any = {
		settings: { maxChars: 50, maxAttempts: 3, timeoutMs: 0, debug: false, defaultPrompt: "P" },
		getActiveProvider: () => ({ id: "ollama", config: { models: ["llama3"], selectedModel: "llama3" } }),
		getBackend: () => ({ translate }),
		buildProviderRequest: () => ({ provider: "ollama", baseUrl: "", apiKey: "", extraHeadersRaw: "", timeoutMs: 0 }),
		...overrides,
	};
	return { plugin, translate };
}

function callbacks() {
	return { onStatus: jest.fn(), onResult: jest.fn(), onError: jest.fn() };
}

const input = { sourceText: "hello", sourceLang: "en", targetLang: "zh" };

describe("runTranslationJob", () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it("rejects empty and oversized text", async () => {
		const { plugin, translate } = fakePlugin();
		const cb = callbacks();
		await runTranslationJob(plugin, { ...input, sourceText: "  " }, cb);
		expect(cb.onError).toHaveBeenCalledWith("No source text to translate.");
		await runTranslationJob(plugin, { ...input, sourceText: "x".repeat(51) }, cb);
		expect(cb.onError.mock.calls[1][0]).toMatch(/too long/);
		expect(translate).not.toHaveBeenCalled();
	});

	it("errors when no model is selected", async () => {
		const { plugin } = fakePlugin({
			getActiveProvider: () => ({ id: "openrouter", config: { models: [], selectedModel: "" } }),
		});
		const cb = callbacks();
		await runTranslationJob(plugin, input, cb);
		expect(cb.onError.mock.calls[0][0]).toMatch(/No model selected for OpenRouter/);
	});

	it("delivers a result, using the model override and prompt override", async () => {
		const { plugin, translate } = fakePlugin({
			getActiveProvider: () => ({ id: "ollama", config: { models: ["a", "b"], selectedModel: "a" } }),
		});
		translate.mockResolvedValue(result());
		const cb = callbacks();
		const out = await runTranslationJob(plugin, { ...input, model: "b", prompt: "custom" }, cb);
		expect(out?.directTranslation).toBe("Direct text.");
		expect(cb.onStatus).toHaveBeenCalledWith("Translating…");
		expect(cb.onResult).toHaveBeenCalledTimes(1);
		expect(translate.mock.calls[0][3]).toMatchObject({ model: "b", prompt: "custom" });
	});

	it("uses the selected model as-is when the model list is empty", async () => {
		const { plugin, translate } = fakePlugin({
			getActiveProvider: () => ({ id: "openwebui", config: { models: [], selectedModel: "typed" } }),
		});
		translate.mockResolvedValue(result());
		await runTranslationJob(plugin, input, callbacks());
		expect(translate.mock.calls[0][3].model).toBe("typed");
	});

	it("retries soft errors then succeeds", async () => {
		const { plugin, translate } = fakePlugin();
		translate.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED")).mockResolvedValueOnce(result());
		const cb = callbacks();
		const run = runTranslationJob(plugin, input, cb);
		await jest.advanceTimersByTimeAsync(400);
		await run;
		expect(translate).toHaveBeenCalledTimes(2);
		expect(cb.onStatus).toHaveBeenCalledWith("Retrying (2/3)…");
		expect(cb.onResult).toHaveBeenCalledTimes(1);
	});

	it("stops immediately on hard errors and after exhausting attempts", async () => {
		const { plugin, translate } = fakePlugin();
		translate.mockRejectedValue(new Error("HTTP 401: nope"));
		const cb = callbacks();
		await runTranslationJob(plugin, input, cb);
		expect(translate).toHaveBeenCalledTimes(1);
		expect(cb.onError).toHaveBeenCalledWith("Translation failed: HTTP 401: nope");

		translate.mockReset().mockRejectedValue("HTTP 503");
		const cb2 = callbacks();
		const run = runTranslationJob(plugin, input, cb2);
		await jest.advanceTimersByTimeAsync(2000);
		await run;
		expect(translate).toHaveBeenCalledTimes(3);
		expect(cb2.onError).toHaveBeenCalledWith("Translation failed: HTTP 503");
	});

	it("skips callbacks once the request is stale", async () => {
		const { plugin, translate } = fakePlugin();
		translate.mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error("timeout"));
		const cb = callbacks();
		const stale = { isStale: () => true };
		await expect(runTranslationJob(plugin, input, cb, stale)).resolves.toBeUndefined();
		await expect(runTranslationJob(plugin, input, cb, stale)).resolves.toBeUndefined();
		expect(cb.onResult).not.toHaveBeenCalled();
		expect(cb.onError).not.toHaveBeenCalled();
	});

	it("drops a retry when the job goes stale during the back-off", async () => {
		const { plugin, translate } = fakePlugin();
		translate.mockRejectedValue(new Error("timeout"));
		let stale = false;
		const cb = callbacks();
		const run = runTranslationJob(plugin, input, cb, { isStale: () => stale });
		await Promise.resolve();
		stale = true;
		await jest.advanceTimersByTimeAsync(400);
		await expect(run).resolves.toBeUndefined();
		expect(translate).toHaveBeenCalledTimes(1);
	});
});
