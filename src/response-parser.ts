/**
 * Parses model replies for the two tasks. Pure module (no `obsidian` import).
 *
 * - Translation replies are expected to be plain text; stray section markers
 *   or code fences are tolerated.
 * - Rewrite replies carry a NATIVE section and a SUGGESTIONS section; when the
 *   markers are missing the whole reply is treated as the rewrite.
 */

export interface RewriteResult {
	nativeRewrite: string;
	suggestions: string[];
	raw: string;
}

export const SECTION_MARKERS = {
	direct: "### DIRECT",
	native: "### NATIVE",
	suggestions: "### SUGGESTIONS",
} as const;

/**
 * Appended to the rewrite prompt when it does not already mention the NATIVE
 * marker. `{{sourceLang}}` is substituted by the backend.
 */
export const REWRITE_PROMPT_SUFFIX = [
	"Format your entire reply with exactly these two sections and nothing else:",
	"",
	SECTION_MARKERS.native,
	"The rewritten text, in {{sourceLang}}.",
	"",
	SECTION_MARKERS.suggestions,
	'At most five short bullet points explaining what you changed and why (grammar, word choice, idiom, tone). Write "- none" if nothing needed changing.',
].join("\n");

type SectionKey = "direct" | "native" | "suggestions";

/**
 * A section heading is the label alone on a line, wrapped in at least one of:
 * leading `#`s, `**bold**`, or a trailing colon. A bare "Direct" line in the
 * text itself is left alone.
 */
const HEADING_RE =
	/^[ \t]*(#{1,6}[ \t]*)?(\*\*)?[ \t]*(DIRECT(?:[ \t]+TRANSLATION)?|NATIVE(?:[ \t]+(?:POLISH|REWRITE))?|REWRITE|SUGGESTIONS?)[ \t]*(?:\*\*)?[ \t]*(:)?[ \t]*$/i;

function matchHeading(line: string): SectionKey | null {
	const m = HEADING_RE.exec(line);
	if (!m) return null;
	if (!(m[1] || m[2] || m[4])) return null;
	const upper = m[3].toUpperCase();
	if (upper.startsWith("DIRECT")) return "direct";
	if (upper.startsWith("SUGGESTION")) return "suggestions";
	return "native";
}

/** Removes one wrapping ``` fence when the whole text is fenced. */
function stripOuterFence(text: string): string {
	const lines = text.split("\n");
	if (lines.length >= 2 && /^\s*```/.test(lines[0]) && /^\s*```\s*$/.test(lines[lines.length - 1])) {
		return lines.slice(1, -1).join("\n");
	}
	return text;
}

interface Split {
	preamble: string;
	sections: Record<SectionKey, string>;
	seen: Record<SectionKey, boolean>;
	anyMarker: boolean;
}

function splitSections(rawInput: string): Split {
	const text = stripOuterFence((rawInput ?? "").replace(/\r\n?/g, "\n").trim());
	const buckets: Record<SectionKey, string[]> = { direct: [], native: [], suggestions: [] };
	const seen: Record<SectionKey, boolean> = { direct: false, native: false, suggestions: false };
	const preamble: string[] = [];
	let current: SectionKey | null = null;

	for (const line of text.split("\n")) {
		const key = matchHeading(line);
		if (key) {
			current = key;
			seen[key] = true;
			continue;
		}
		(current ? buckets[current] : preamble).push(line);
	}
	return {
		preamble: preamble.join("\n").trim(),
		sections: {
			direct: buckets.direct.join("\n").trim(),
			native: buckets.native.join("\n").trim(),
			suggestions: buckets.suggestions.join("\n").trim(),
		},
		seen,
		anyMarker: seen.direct || seen.native || seen.suggestions,
	};
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

/** Plain translation; tolerates a model that still emits section markers. */
export function parseTranslationResponse(raw: string): string {
	const split = splitSections(raw);
	if (!split.anyMarker) return split.preamble;
	if (split.seen.direct && split.sections.direct) return split.sections.direct;
	return split.preamble || split.sections.native;
}

export function parseRewriteResponse(raw: string): RewriteResult {
	const normalized = (raw ?? "").replace(/\r\n?/g, "\n");
	const split = splitSections(normalized);
	if (!split.anyMarker) {
		return { nativeRewrite: split.preamble, suggestions: [], raw: normalized };
	}
	const rewrite = split.sections.native || split.sections.direct || split.preamble;
	return {
		nativeRewrite: rewrite,
		suggestions: parseSuggestionList(split.sections.suggestions),
		raw: normalized,
	};
}
