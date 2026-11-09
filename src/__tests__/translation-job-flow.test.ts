import { REWRITE_PROMPT_SUFFIX } from "../response-parser";
import { buildTaskPrompt, runRewrite, runTask, runTranslate } from "../translation-job";

function fakePlugin(overrides: Partial<any> = {}) {
	const complete = jest.fn();
	const plugin: any = {
		settings: {
			maxChars: 50,
			maxAttempts: 3,
			timeoutMs: 0,
			debug: false,
			translatePrompt: "T {{sourceLang}}>{{targetLang}}",
			rewritePrompt: "R {{sourceLang}}",
			tasks: { translate: { provider: "ollama", model: "gemma" }, rewrite: { provider: "openrouter", model: "a/b" } },
		},
		getBackend: () => ({ complete }),
		buildProviderRequest: (provider: string) => ({ provider, baseUrl: "", apiKey: "", extraHeadersRaw: "", timeoutMs: 0 }),
		...overrides,
	};
	return { plugin, complete };
}

function callbacks() {
	return { onStatus: jest.fn(), onResult: jest.fn(), onError: jest.fn() };
}

const input = { sourceText: "hello", sourceLang: "en", targetLang: "zh" };

describe("buildTaskPrompt", () => {
	it("renders the translation prompt and appends the rewrite format once", () => {
		const { plugin } = fakePlugin();
		expect(buildTaskPrompt(plugin, "translate", input)).toBe("T en>zh");
		const rewrite = buildTaskPrompt(plugin, "rewrite", input);
		expect(rewrite.startsWith("R en\n\n")).toBe(true);
		expect(rewrite).toContain("### NATIVE");
		plugin.settings.rewritePrompt = `Own ${REWRITE_PROMPT_SUFFIX}`;
		expect(buildTaskPrompt(plugin, "rewrite", input).match(/### NATIVE/g)).toHaveLength(1);
	});
});

describe("runTask", () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it("rejects empty and oversized text", async () => {
		const { plugin, complete } = fakePlugin();
		const cb = callbacks();
		await runTask(plugin, "translate", { ...input, sourceText: "  " }, cb);
		expect(cb.onError).toHaveBeenCalledWith("No source text.");
		await runTask(plugin, "translate", { ...input, sourceText: "x".repeat(51) }, cb);
		expect(cb.onError.mock.calls[1][0]).toMatch(/too long/);
		expect(complete).not.toHaveBeenCalled();
	});

	it("errors when the task has no model", async () => {
		const { plugin } = fakePlugin();
		plugin.settings.tasks.rewrite.model = "";
		const cb = callbacks();
		await runTask(plugin, "rewrite", input, cb);
		expect(cb.onError.mock.calls[0][0]).toMatch(/No model chosen for native rewrite \(OpenRouter\)/);
	});

	it("routes each task to its own provider and model", async () => {
		const { plugin, complete } = fakePlugin();
		complete.mockResolvedValue("ok");
		const cb = callbacks();
		await runTask(plugin, "translate", input, cb);
		await runTask(plugin, "rewrite", input, cb);
		expect(complete.mock.calls[0][2]).toMatchObject({ provider: "ollama", model: "gemma" });
		expect(complete.mock.calls[0][0]).toBe("T en>zh");
		expect(complete.mock.calls[1][2]).toMatchObject({ provider: "openrouter", model: "a/b" });
		expect(cb.onStatus).toHaveBeenCalledWith("Translating…");
		expect(cb.onStatus).toHaveBeenCalledWith("Rewriting…");
		expect(cb.onResult).toHaveBeenCalledTimes(2);
	});

	it("retries soft errors then succeeds", async () => {
		const { plugin, complete } = fakePlugin();
		complete.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED")).mockResolvedValueOnce("ok");
		const cb = callbacks();
		const run = runTask(plugin, "translate", input, cb);
		await jest.advanceTimersByTimeAsync(400);
		await expect(run).resolves.toBe("ok");
		expect(complete).toHaveBeenCalledTimes(2);
		expect(cb.onStatus).toHaveBeenCalledWith("Retrying (2/3)…");
	});

	it("stops immediately on hard errors and after exhausting attempts", async () => {
		const { plugin, complete } = fakePlugin();
		complete.mockRejectedValue(new Error("HTTP 401: nope"));
		const cb = callbacks();
		await runTask(plugin, "translate", input, cb);
		expect(complete).toHaveBeenCalledTimes(1);
		expect(cb.onError).toHaveBeenCalledWith("Translation failed: HTTP 401: nope");

		complete.mockReset().mockRejectedValue("HTTP 503");
		const cb2 = callbacks();
		const run = runTask(plugin, "rewrite", input, cb2);
		await jest.advanceTimersByTimeAsync(2000);
		await run;
		expect(complete).toHaveBeenCalledTimes(3);
		expect(cb2.onError).toHaveBeenCalledWith("Native rewrite failed: HTTP 503");
	});

	it("skips callbacks once the request is stale", async () => {
		const { plugin, complete } = fakePlugin();
		complete.mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("timeout"));
		const cb = callbacks();
		const stale = { isStale: () => true };
		await expect(runTask(plugin, "translate", input, cb, stale)).resolves.toBeUndefined();
		await expect(runTask(plugin, "translate", input, cb, stale)).resolves.toBeUndefined();
		expect(cb.onResult).not.toHaveBeenCalled();
		expect(cb.onError).not.toHaveBeenCalled();
	});

	it("drops a retry when the job goes stale during the back-off", async () => {
		const { plugin, complete } = fakePlugin();
		complete.mockRejectedValue(new Error("timeout"));
		let stale = false;
		const run = runTask(plugin, "translate", input, callbacks(), { isStale: () => stale });
		await Promise.resolve();
		stale = true;
		await jest.advanceTimersByTimeAsync(400);
		await expect(run).resolves.toBeUndefined();
		expect(complete).toHaveBeenCalledTimes(1);
	});
});

describe("runTranslate / runRewrite", () => {
	it("parse the replies for their task", async () => {
		const { plugin, complete } = fakePlugin();
		complete.mockResolvedValueOnce("### DIRECT\n你好\n### NATIVE\nx");
		const cb = callbacks();
		await expect(runTranslate(plugin, input, cb)).resolves.toBe("你好");
		expect(cb.onResult).toHaveBeenCalledWith("你好");

		complete.mockResolvedValueOnce("### NATIVE\nHi there.\n### SUGGESTIONS\n- a");
		const cb2 = callbacks();
		await expect(runRewrite(plugin, input, cb2)).resolves.toMatchObject({ nativeRewrite: "Hi there.", suggestions: ["a"] });

		complete.mockRejectedValueOnce(new Error("HTTP 400"));
		await expect(runRewrite(plugin, input, callbacks())).resolves.toBeUndefined();
	});
});
