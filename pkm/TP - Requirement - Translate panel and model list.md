---
project_code: 'TP'
id: 'tp-requirement-translate-panel-and-model-list'
date: 2026-07-22
type: requirement
status: completed
---

# Design: Translate Panel + Shared Model List

> Retired in 2.0: commit `06d9725` (2026-11-09) removed the side panel and the `translate-block` code block. Settings from 1.x (including `modelsRaw`) are migrated by `src/settings-migration.ts`.

Design status at the time: approved (Approach 2). Scope at the time: `.obsidian/plugins/st-translate-block/` only. Plan: [[TP - Plan - Translate panel and model list]]. Builds on [[TP - Requirement - Translate block]].

## Problem

Add a standalone translator **side panel** (Obsidian `ItemView`) that reuses one shared **TranslateWorkspace** UI with fenced `translate-block` previews. Add a settings **model list** (one name per line); model pickers are dropdowns fed only by that list.

## Acceptance criteria

1. Ribbon/command opens translator in the right sidebar; leaf can be dragged to main.
2. Panel has stacked Input/controls/Output, Translate + Auto, shared backend.
3. Settings Models textarea drives dropdowns in settings, panel, and blocks.
4. Closing Obsidian clears panel session state.
5. Existing fence translate-block + Save to block still work.

## Constraints

### Decisions (from brainstorming)

| Topic              | Choice                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| Open location      | Always open in the **right sidebar**; user may drag the leaf to the main workspace |
| Translate trigger  | Keep **Translate** button + **Auto** toggle (same as current blocks)               |
| Layout             | **Stacked** (Input → controls → Output)                                            |
| Open entry points  | **Ribbon icon** + **command**                                                      |
| Model list UI      | Settings **textarea**, one model per line                                          |
| Model picker scope | Dropdown in **panel and blocks**; options from settings only                       |
| Fence `model=`     | If value ∈ list → initial selection; else → `defaultModel`                         |
| Panel persistence  | **Session only** (no persist of text/langs/model across restart)                   |
| Architecture       | **Approach 2** — shared `TranslateWorkspace` component                             |
| Work root          | Plugin directory only                                                              |

### Out of scope (v1)

- Debounced type-to-translate
- Side-by-side Google layout
- Persist panel text
- “Translate selection” context menu
- Fetching model list from Ollama API
- Tests (separate task per project rule)

## Implementation steps

### Architecture

```
TranslateBlockPlugin
  ├── settings (modelsRaw, defaultModel, …)
  ├── TranslationBackend (unchanged)
  ├── workspace registry (id → TranslateWorkspaceState)
  ├── poll loop (auto mode only)
  ├── TranslatePanelView (ItemView) ──┐
  └── processTranslateBlock ─────────┴──► TranslateWorkspace
```

**TranslateWorkspace** owns:

- DOM: input, language selects, model select, Translate, Auto, output, status
- Local state: sourceText, langs, model, mode, inFlight, hash, retries
- Callbacks into the plugin for `runTranslationJob`

**Hosts** own:

- Panel: create/destroy leaf; no Save to block; session-only state
- Block: fence parse; optional **Save to block**; note-backed initial text

### Settings

New field:

- `modelsRaw: string` — newline-separated model names

Adjusted field:

- `defaultModel: string` — must resolve to an entry in `parseModelList(modelsRaw)`

Helpers:

- `parseModelList(raw): string[]` — trim, drop empty, dedupe, preserve order; if empty → `[fallback]`
- `resolveModel(list, preferred): string` — preferred if in list, else first list entry

Settings UI:

1. **Models** textarea (`setting-control-on-new-line`)
2. **Default model** dropdown from parsed list; when `modelsRaw` changes and current default is missing, reset to first entry

Remove free-text default-model input.

Defaults:

```
modelsRaw: "llama3"
defaultModel: "llama3"
```

### TranslateWorkspace API (sketch)

```ts
type TranslateMode = 'manual' | 'auto';

type TranslateWorkspaceOptions = {
	id: string;
	initialSourceText: string;
	initialSourceLang: string;
	initialTargetLang: string;
	initialModel: string;
	prompt: string;
	/** Host-only control (blocks). */
	onSaveToBlock?: () => void;
};

type TranslateWorkspaceHandle = {
	id: string;
	getState(): TranslateWorkspaceState;
	destroy(): void;
	refreshModelOptions(): void;
};
```

Mount builds stacked UI using existing CSS class names (`translate-block-*`) plus a panel root class when needed.

### Side panel view

- `VIEW_TYPE_TRANSLATE_PANEL = "translate-panel"`
- `TranslatePanelView extends ItemView`
- `onload`: register view; ribbon + command `Open Translate Panel`
- Open helper: prefer existing leaf of this type; else `getRightLeaf(false)` / create in right sidebar; `setViewState`
- On open: mount workspace with settings defaults and empty source text
- On close: unregister workspace from plugin map; session state discarded

### Block integration

- Replace inline DOM in `processTranslateBlock` with `mountTranslateWorkspace`
- Pass `onSaveToBlock` when section info exists
- Model `<select>` from `parseModelList`; fence `model=` only if in list
- Keep encode/decode fence escape and Save-to-block behaviour

### Translation job / polling

- Generalize `blockStates` → workspace registry shared by panel + blocks
- `runTranslationJob` / `pollBlocks` unchanged in behaviour; iterate all auto workspaces
- Model for API = workspace selected model (always from list after UI constraint)

### Error handling

- Reuse existing soft/hard retry rules and Notices
- Empty source → status message, no request
- Over `maxChars` → same warnings as today

## Validation

- Implemented in commit `0a044fe` (feat: add translate side panel and shared model/language dropdowns, 2026-07-22) and released as 1.1.0 (`94d71dc`).
- Tests were out of scope for this design; the repository holds no validation record for the acceptance criteria.

## Open decisions

None recorded.
