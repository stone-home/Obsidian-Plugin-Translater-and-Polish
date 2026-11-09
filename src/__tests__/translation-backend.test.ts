import { requestUrl } from "obsidian";
import { HttpTranslationBackend, buildSystemPrompt, withTimeout } from "../translation-backend";
import { STRUCTURED_PROMPT_SUFFIX } from "../response-parser";

const mockedRequest = requestUrl as unknown as jest.Mock;

function response(status: number, json: unknown, text = JSON.stringify(json)) {
	return { status, text, json };
}

function brokenJsonResponse(status: number, text: string) {
	return {
		status,
		text,
		get json(): unknown {
			throw new SyntaxError("Unexpected token <");
		},
	};
}

const base = { apiKey: "", extraHeadersRaw: "", timeoutMs: 0, debug: false };

describe("buildSystemPrompt", () => {
	it("appends the structured suffix and substitutes placeholders", () => {
		const prompt = buildSystemPrompt("Translate from {{sourceLang}} to {{targetLang}}.", "zh", "en");
		expect(prompt.startsWith("Translate from zh to en.")).toBe(true);
		expect(prompt).toContain("### DIRECT");
		expect(prompt).not.toContain("{{targetLang}}");
	});

	it("maps auto to the detected language and does not double the suffix", () => {
		const custom = `From {{sourceLang}}.\n${STRUCTURED_PROMPT_SUFFIX}`;
		const prompt = buildSystemPrompt(custom, "auto", "en");
		expect(prompt).toContain("the detected language");
		expect(prompt.match(/### DIRECT/g)).toHaveLength(1);
	});

	it("falls back to the default prompt when empty", () => {
		expect(buildSystemPrompt("", "en", "zh")).toContain("professional translator");
	});
});

describe("withTimeout", () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it("passes through when ms is not positive", async () => {
		await expect(withTimeout(Promise.resolve(1), 0)).resolves.toBe(1);
	});

	it("resolves before the deadline", async () => {
		await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
	});

	it("rejects with a timeout error and swallows the late rejection", async () => {
		let rejectLate: (e: Error) => void = () => undefined;
		const late = new Promise<never>((_, reject) => {
			rejectLate = reject;
		});
		const raced = withTimeout(late, 50);
		jest.advanceTimersByTime(60);
		await expect(raced).rejects.toThrow("Request timeout after 50 ms");
		rejectLate(new Error("late network failure"));
		await Promise.resolve();
	});
});

describe("HttpTranslationBackend.translate", () => {
	const backend = new HttpTranslationBackend();
	beforeEach(() => mockedRequest.mockReset());

	it("posts an Ollama chat request and parses the sections", async () => {
		mockedRequest.mockResolvedValue(
			response(200, { message: { content: "### DIRECT\nHi\n### NATIVE\nHey\n### SUGGESTIONS\n- none" } }),
		);
		const parsed = await backend.translate("你好", "zh", "en", {
			...base,
			provider: "ollama",
			baseUrl: "http://localhost:13434/",
			model: "llama3",
			prompt: "",
			debug: true,
		});
		expect(parsed.directTranslation).toBe("Hi");
		expect(parsed.nativePolish).toBe("Hey");
		const call = mockedRequest.mock.calls[0][0];
		expect(call.url).toBe("http://localhost:13434/api/chat");
		const body = JSON.parse(call.body);
		expect(body.stream).toBe(false);
		expect(body.messages[1]).toEqual({ role: "user", content: "你好" });
		expect(call.headers.Authorization).toBeUndefined();
	});

	it("posts an OpenAI-style request for OpenRouter with auth headers", async () => {
		mockedRequest.mockResolvedValue(response(200, { choices: [{ message: { content: "Bonjour" } }] }));
		const parsed = await backend.translate("Hello", "en", "fr", {
			...base,
			provider: "openrouter",
			baseUrl: "",
			apiKey: "sk-1",
			model: "a/b",
			prompt: "p",
		});
		expect(parsed.directTranslation).toBe("Bonjour");
		const call = mockedRequest.mock.calls[0][0];
		expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(JSON.parse(call.body).temperature).toBe(0.2);
		expect(call.headers.Authorization).toBe("Bearer sk-1");
		expect(call.headers["X-Title"]).toBeDefined();
	});

	it("throws on HTTP errors with a body snippet", async () => {
		mockedRequest.mockResolvedValue(response(401, { error: "bad key" }));
		await expect(
			backend.translate("x", "en", "fr", { ...base, provider: "openwebui", baseUrl: "http://w", model: "m", prompt: "" }),
		).rejects.toThrow(/HTTP 401: .*bad key/);
	});

	it("reports non-JSON bodies readably", async () => {
		mockedRequest.mockResolvedValue(brokenJsonResponse(200, "<html>login</html>"));
		await expect(
			backend.translate("x", "en", "fr", { ...base, provider: "openwebui", baseUrl: "http://w", model: "m", prompt: "" }),
		).rejects.toThrow("response was not JSON");
	});

	it("throws when the reply has no content", async () => {
		mockedRequest.mockResolvedValue(response(200, { choices: [] }));
		await expect(
			backend.translate("x", "en", "fr", { ...base, provider: "openrouter", baseUrl: "", model: "m", prompt: "" }),
		).rejects.toThrow("No content");
		mockedRequest.mockResolvedValue(response(200, { message: { content: 42 } }));
		await expect(
			backend.translate("x", "en", "fr", { ...base, provider: "ollama", baseUrl: "", model: "m", prompt: "" }),
		).rejects.toThrow("No content");
	});
});

describe("HttpTranslationBackend.listModels", () => {
	const backend = new HttpTranslationBackend();
	beforeEach(() => mockedRequest.mockReset());

	it("maps each provider's response", async () => {
		mockedRequest.mockResolvedValueOnce(response(200, { models: [{ name: "b" }, { name: "a" }] }));
		await expect(backend.listModels({ ...base, provider: "ollama", baseUrl: "http://o" })).resolves.toEqual(["a", "b"]);
		expect(mockedRequest.mock.calls[0][0].url).toBe("http://o/api/tags");
		expect(mockedRequest.mock.calls[0][0].method).toBe("GET");

		mockedRequest.mockResolvedValueOnce(response(200, { data: [{ id: "z" }] }));
		await expect(backend.listModels({ ...base, provider: "openwebui", baseUrl: "http://w" })).resolves.toEqual(["z"]);
	});

	it("throws on HTTP and parse errors", async () => {
		mockedRequest.mockResolvedValueOnce(response(500, {}, ""));
		await expect(backend.listModels({ ...base, provider: "openrouter", baseUrl: "" })).rejects.toThrow("HTTP 500");
		mockedRequest.mockResolvedValueOnce(brokenJsonResponse(200, "<html>"));
		await expect(backend.listModels({ ...base, provider: "openrouter", baseUrl: "" })).rejects.toThrow("not JSON");
	});
});
