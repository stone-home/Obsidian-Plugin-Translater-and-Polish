import {
	buildHeaders,
	chatUrl,
	mapModelsResponse,
	modelsUrl,
	normalizeBaseUrl,
	parseHeaderLines,
	secretId,
} from '../../src/providers';

describe('URL builders', () => {
	it('builds endpoint URLs per provider and strips trailing slashes', () => {
		expect(chatUrl('ollama', 'http://localhost:13434/')).toBe(
			'http://localhost:13434/api/chat'
		);
		expect(modelsUrl('ollama', 'http://localhost:13434')).toBe(
			'http://localhost:13434/api/tags'
		);
		expect(chatUrl('openwebui', 'https://webui.example.com//')).toBe(
			'https://webui.example.com/api/chat/completions'
		);
		expect(modelsUrl('openwebui', 'https://webui.example.com')).toBe(
			'https://webui.example.com/api/models'
		);
		expect(chatUrl('openrouter', '')).toBe(
			'https://openrouter.ai/api/v1/chat/completions'
		);
		expect(modelsUrl('openrouter', 'https://openrouter.ai')).toBe(
			'https://openrouter.ai/api/v1/models'
		);
	});

	it('falls back to the provider default when the base URL is blank', () => {
		expect(normalizeBaseUrl('openwebui', '   ')).toBe('http://localhost:3000');
		expect(normalizeBaseUrl('openai-compatible', '   ')).toBe(
			'http://localhost:4000'
		);
	});

	it('builds OpenAI-compatible URLs with or without a /v1 suffix', () => {
		expect(chatUrl('openai-compatible', 'http://localhost:4000/')).toBe(
			'http://localhost:4000/v1/chat/completions'
		);
		expect(modelsUrl('openai-compatible', 'http://localhost:4000')).toBe(
			'http://localhost:4000/v1/models'
		);
		expect(chatUrl('openai-compatible', 'https://gw.example.com/litellm/v1/')).toBe(
			'https://gw.example.com/litellm/v1/chat/completions'
		);
		expect(
			modelsUrl('openai-compatible', 'https://gw.example.com/litellm/V1')
		).toBe('https://gw.example.com/litellm/V1/models');
		expect(chatUrl('openai-compatible', '')).toBe(
			'http://localhost:4000/v1/chat/completions'
		);
	});
});

describe('headers', () => {
	it('parses Key: Value lines and ignores junk', () => {
		expect(parseHeaderLines('A: 1\n\nnocolon\nB:  two: parts \n: empty')).toEqual({
			A: '1',
			B: 'two: parts',
		});
	});

	it('adds Bearer auth and OpenRouter attribution, user headers win', () => {
		const headers = buildHeaders('openrouter', ' sk-test ', 'X-Title: Mine');
		expect(headers.Authorization).toBe('Bearer sk-test');
		expect(headers['HTTP-Referer']).toContain('github.com');
		expect(headers['X-Title']).toBe('Mine');
	});

	it('omits Authorization when the key is empty', () => {
		expect(buildHeaders('ollama', '', '')).toEqual({});
	});
});

describe('mapModelsResponse', () => {
	it('maps Ollama tags', () => {
		expect(
			mapModelsResponse('ollama', {
				models: [{ name: 'mistral' }, { name: 'llama3' }, { name: 'llama3' }],
			})
		).toEqual(['llama3', 'mistral']);
	});

	it('maps OpenAI-style lists for OpenRouter and Open WebUI', () => {
		const json = { data: [{ id: 'b/model' }, { id: 'a/model' }, { nope: 1 }] };
		expect(mapModelsResponse('openrouter', json)).toEqual(['a/model', 'b/model']);
		expect(mapModelsResponse('openwebui', json)).toEqual(['a/model', 'b/model']);
		expect(mapModelsResponse('openai-compatible', json)).toEqual([
			'a/model',
			'b/model',
		]);
	});

	it('returns an empty list for malformed input', () => {
		expect(mapModelsResponse('ollama', null)).toEqual([]);
		expect(mapModelsResponse('openrouter', 'nope')).toEqual([]);
		expect(mapModelsResponse('openwebui', { data: 'x' })).toEqual([]);
	});
});

describe('secretId', () => {
	it('is lowercase alphanumeric with dashes', () => {
		for (const id of [
			'ollama',
			'openrouter',
			'openwebui',
			'openai-compatible',
		] as const) {
			expect(secretId(id)).toMatch(/^[a-z0-9-]+$/);
		}
	});
});
