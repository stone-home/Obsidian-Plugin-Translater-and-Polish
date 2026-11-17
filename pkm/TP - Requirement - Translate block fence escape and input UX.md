---
project_code: 'TP'
id: 'tp-requirement-translate-block-fence-escape-input-ux'
date: 2026-03-02
type: requirement
status: completed
---

# Translate Block – Fence Safety and Input Panel UX

> Retired in 2.0: commit `06d9725` (2026-11-09) removed the `translate-block` code block, including Save to block and fence escaping.

Related: [[TP - Requirement - Translate block]].

## Problem

Fix for Save-to-block crash when content contains fence-like lines (encode/decode with U+200B), plus input panel UX: auto-growing height by line count and larger input text size.

### Save-to-Block Fence Crash

- **Problem:** When the user clicks "Save to block", the plugin writes the textarea content back into the fenced code block. If that content contains a line that could be interpreted as a closing fence (e.g. ` ``` ` or `  ``` ` with optional leading/trailing whitespace), the markdown parser treats it as the closing fence and the code block structure breaks or "disappears".
- **Requirement:** Content must be saved without allowing any user-written line to close the block.
- **Approach:** Encode before save and decode when loading. Use a zero-width space (U+200B) only on fence-like lines (optional leading/trailing whitespace + 3+ backticks): append U+200B so the line is not a valid closing fence; strip it when loading so the user sees the original line. When saving, resolve the opening fence line by searching for a line that starts with ` ```translate-block ` (same as `parseFenceConfig`), not by assuming the first line of section text.

### Input Panel UX

- **Requirement:** The input panel height should grow automatically with the number of lines of content (no fixed height beyond a minimum).
- **Requirement:** Input text should be 2 size units larger than the default for readability (e.g. `calc(1em + 2px)`).

## Acceptance criteria

- Saving content that includes a fence-like line (e.g. ` ``` ` or `  ``` `) no longer breaks the code block; the block re-renders correctly and the user sees the original line in the input.
- Save to block uses the correct opening fence line (e.g. ` ```translate-block source=en target=zh `) even when section text does not start with it.
- Input panel height increases as the user adds lines and shrinks when lines are removed (minimum 120px); no scrollbar when content fits.
- Input text is visibly larger (2px over inherited size).

## Constraints

- The solution must be safe for markdown and LaTeX (no tokens that could appear in user text).
- The input panel keeps a minimum height of 120px.

## Implementation steps

### Fence Encode/Decode

- [x] Add `FENCE_ESCAPE` constant (`​`) and helpers `encodeBlockContentForSave(content)` and `decodeBlockContent(source)` in the main plugin.
- [x] **Encode:** Before writing to the file, for each line matching `/^\s*`{3,}\s*$/` (allow leading and trailing whitespace), append U+200B.
- [x] **Decode:** When processing a block, for each line matching `/^(\s*`{3,}\s*)​$/`, replace with the captured fence part (remove trailing U+200B).
- [x] Use encoded content in `updateCodeBlockInFile` when building the new block lines.
- [x] Use decoded content in `processTranslateBlock` for the textarea value and block state (`decodedSource`).
- [x] **Save handler:** Resolve opening fence line via `lines.find(line => line.trim().startsWith("```translate-block"))` instead of `info.text.split("\n")[0]`.

### Input Panel Behavior and Styling

- [x] Add a `resizeInput()` helper: set textarea `height = "0"` then set to `Math.max(120, scrollHeight)` so `scrollHeight` reflects full content.
- [x] Call `resizeInput()` inside `requestAnimationFrame` after setting initial content, and on every `input` event (with existing sync).
- [x] In `.translate-block-input-area` CSS: `font-size: calc(1em + 2px)`, `overflow: hidden`, `resize: none` so height grows with content and no scrollbar/resize handle conflicts.

## Validation

- Shipped in commit `24ddf2a` (fix: translate-block fence escape and input panel UX, 2026-03-02) and released as 1.0.1 (`f63e129`).
- The repository holds no automated tests or validation record for these acceptance criteria from that time.
- The earlier filename said `20250302`; the commit date is 2026-03-02, which is the date recorded here.

## Open decisions

None recorded.
