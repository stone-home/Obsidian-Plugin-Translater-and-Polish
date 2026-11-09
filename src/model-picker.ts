import { TaskBinding, TranslatePolishSettings } from "./defaults";
import { PROVIDER_IDS, PROVIDER_LABELS, ProviderId } from "./providers";

const SEPARATOR = "::";

export function encodeBinding(binding: TaskBinding): string {
	return `${binding.provider}${SEPARATOR}${binding.model}`;
}

export function decodeBinding(value: string): TaskBinding | undefined {
	const idx = value.indexOf(SEPARATOR);
	if (idx === -1) return undefined;
	const provider = value.slice(0, idx) as ProviderId;
	const model = value.slice(idx + SEPARATOR.length);
	if (!(PROVIDER_IDS as readonly string[]).includes(provider) || !model) return undefined;
	return { provider, model };
}

/**
 * Fills a `<select>` with every fetched model, grouped by provider, and selects
 * `current`. A current model missing from the lists is kept as an extra option
 * so it is never silently replaced. Returns whether any option exists.
 */
export function fillTaskModelSelect(
	select: HTMLSelectElement,
	settings: TranslatePolishSettings,
	current: TaskBinding,
): boolean {
	select.empty();
	let count = 0;
	let currentSeen = false;
	for (const id of PROVIDER_IDS) {
		const models = settings.providers[id].models;
		if (models.length === 0) continue;
		const group = select.createEl("optgroup");
		group.label = PROVIDER_LABELS[id];
		for (const model of models) {
			const value = encodeBinding({ provider: id, model });
			const opt = group.createEl("option", { value, text: model });
			if (id === current.provider && model === current.model) {
				opt.selected = true;
				currentSeen = true;
			}
			count += 1;
		}
	}
	if (current.model && !currentSeen) {
		const opt = select.createEl("option", {
			value: encodeBinding(current),
			text: `${current.model} (${PROVIDER_LABELS[current.provider]}, not in fetched list)`,
		});
		opt.selected = true;
		count += 1;
	}
	if (count === 0) {
		const opt = select.createEl("option", { value: "", text: "No models. Fetch models in settings." });
		opt.disabled = true;
		opt.selected = true;
	}
	select.disabled = count === 0;
	return count > 0;
}
