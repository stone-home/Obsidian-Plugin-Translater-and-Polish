/**
 * Parses the three-section model reply (direct translation, native polish,
 * suggestions). Pure module (no `obsidian` import).
 */

export interface StructuredTranslation {
	directTranslation: string;
	nativePolish: string;
	suggestions: string[];
	raw: string;
}

export const SECTION_MARKERS = {
	direct: "### DIRECT",
	native: "### NATIVE",
	suggestions: "### SUGGESTIONS",
} as const;

/**
 * Appended to the user's prompt when it does not already mention the DIRECT
 * marker. `{{targetLang}}` is substituted by the backend.
 */
export const STRUCTURED_PROMPT_SUFFIX = [
	"Format your entire reply with exactly these three sections and nothing else:",
	"",
	SECTION_MARKERS.direct,
	"A faithful, standard translation of the text into {{targetLang}}.",
	"",
	SECTION_MARKERS.native,
	"The same content rewritten the way a native {{targetLang}} speaker would naturally phrase it, keeping the meaning and tone.",
	"",
	SECTION_MARKERS.suggestions,
	'At most five short bullet points about grammar, word choice or style in the source text. Write "- none" if there is nothing to note.',
].join("\n");

type SectionKey = "direct" | "native" | "suggestions";

/**
 * A section heading is the label alone on a line, wrapped in at least one of:
 * leading `#`s, `**bold**`, or a trailing colon. A bare "Direct" line in the
 * translation itself is left alone.
 */
const HEADING_RE =
	/^[ \t]*(#{1,6}[ \t]*)?(\*\*)?[ \t]*(DIRECT(?:[ \t]+TRANSLATION)?|NATIVE(?:[ \t]+POLISH)?|SUGGESTIONS?)[ \t]*(?:\*\*)?[ \t]*(:)?[ \t]*$/i;

function matchHeading(line: string): string | null {
	const m = HEADING_RE.exec(line);
	if (!m) return null;
	return m[1] || m[2] || m[4] ? m[3] : null;
}

function keyFor(label: string): SectionKey {
	const upper = label.toUpperCase();
	if (upper.startsWith("DIRECT")) return "direct";
	if (upper.startsWith("NATIVE")) return "native";
	return "suggestions";
}

/** Removes one wrapping ``` fence when the whole text is fenced. */
function stripOuterFence(text: string): string {
	const lines = text.split("\n");
	if (lines.length >= 2 && /^\s*```/.test(lines[0]) && /^\s*```\s*$/.test(lines[lines.length - 1])) {
		return lines.slice(1, -1).join("\n");
	}
	return text;
}

export function parseSuggestionList(block: string): string[] {
	const out: string[] = [];
	for (const rawLine of block.split("\n")) {
		const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
		if (!line) continue;
		if (/^(none|no suggestions?|n\/a)\.?$/i.test(line)) continue;
		out.push(line);
	}
	return out;
}

export function parseStructuredResponse(rawInput: string): StructuredTranslation {
	const raw = (rawInput ?? "").replace(/\r\n?/g, "\n");
	const text = stripOuterFence(raw.trim());
	const lines = text.split("\n");

	const sections: Record<SectionKey, string[]> = { direct: [], native: [], suggestions: [] };
	const seen: Record<SectionKey, boolean> = { direct: false, native: false, suggestions: false };
	const preamble: string[] = [];
	let current: SectionKey | null = null;

	for (const line of lines) {
		const label = matchHeading(line);
		if (label) {
			current = keyFor(label);
			seen[current] = true;
			continue;
		}
		if (current) {
			sections[current].push(line);
		} else {
			preamble.push(line);
		}
	}

	const anyMarker = seen.direct || seen.native || seen.suggestions;
	if (!anyMarker) {
		return { directTranslation: text.trim(), nativePolish: "", suggestions: [], raw };
	}

	const direct = sections.direct.join("\n").trim();
	const native = sections.native.join("\n").trim();
	const suggestions = parseSuggestionList(sections.suggestions.join("\n"));
	const fallbackDirect = preamble.join("\n").trim() || native;

	return {
		directTranslation: seen.direct && direct ? direct : fallbackDirect,
		nativePolish: native,
		suggestions,
		raw,
	};
}
