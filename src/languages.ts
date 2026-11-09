/** Shared language codes for settings and translate window dropdowns. */
export const LANGUAGE_OPTIONS = ["auto", "en", "zh", "ja", "fr", "de", "es"] as const;

export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];

/**
 * Returns `preferred` when it is a known option; otherwise `fallback`.
 */
export function resolveLanguage(preferred: string | undefined, fallback: string): string {
	const want = preferred?.trim();
	if (want && (LANGUAGE_OPTIONS as readonly string[]).includes(want)) {
		return want;
	}
	if ((LANGUAGE_OPTIONS as readonly string[]).includes(fallback)) {
		return fallback;
	}
	return LANGUAGE_OPTIONS[0];
}

export function populateLanguageSelect(select: HTMLSelectElement, current: string): void {
	const selected = resolveLanguage(current, LANGUAGE_OPTIONS[0]);
	select.empty();
	for (const value of LANGUAGE_OPTIONS) {
		const opt = select.createEl("option", { value, text: value });
		if (value === selected) {
			opt.selected = true;
		}
	}
}
