const FALLBACK_MODEL = "llama3";

/**
 * Parses a newline-separated model list: trim, drop empties, dedupe (order preserved).
 * Returns a non-empty list (falls back to defaultModel / llama3).
 */
export function parseModelList(raw: string, fallbackModel?: string): string[] {
	const fallback = (fallbackModel?.trim() || FALLBACK_MODEL).trim();
	const seen = new Set<string>();
	const result: string[] = [];

	for (const line of (raw ?? "").split("\n")) {
		const name = line.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		result.push(name);
	}

	if (result.length === 0) {
		return [fallback];
	}
	return result;
}

/**
 * Returns `preferred` when it appears in `list`; otherwise the first list entry.
 */
export function resolveModel(list: string[], preferred: string | undefined): string {
	const models = list.length > 0 ? list : parseModelList("");
	const want = preferred?.trim();
	if (want && models.includes(want)) {
		return want;
	}
	return models[0];
}

/**
 * Fills a `<select>` strictly from `models`; an empty list yields one disabled
 * placeholder option so no phantom model is offered.
 */
export function fillModelSelect(select: HTMLSelectElement, models: string[], current: string): string {
	select.empty();
	if (models.length === 0) {
		const opt = select.createEl("option", { value: "", text: "No models. Fetch in settings." });
		opt.disabled = true;
		opt.selected = true;
		select.disabled = true;
		return "";
	}
	select.disabled = false;
	const selected = models.includes(current) ? current : models[0];
	for (const value of models) {
		const opt = select.createEl("option", { value, text: value });
		if (value === selected) opt.selected = true;
	}
	return selected;
}
