---
project_code: 'TP'
id: 'tp-plan-translate-panel-and-model-list'
date: 2026-07-22
type: plan
status: completed
---

# Translate Panel + Model List Implementation Plan

> Retired in 2.0: commit `06d9725` (2026-11-09) removed the side panel and the `translate-block` code block. Settings from 1.x (including `modelsRaw`) are migrated by `src/settings-migration.ts`.

Requirement: [[TP - Requirement - Translate panel and model list]].

## Problem

**Goal:** Shared `TranslateWorkspace` UI for side panel + `translate-block`, plus settings model list dropdowns.

**Architecture:** Extract mountable workspace; `TranslatePanelView` + block processor both mount it; plugin owns translation jobs/polling; `modelsRaw` feeds all model selects.

**Tech Stack:** Obsidian Plugin API (`ItemView`, `Plugin`, `Setting`), TypeScript, existing `requestUrl` backend.

## Acceptance criteria

The acceptance criteria are those of [[TP - Requirement - Translate panel and model list]].

## Constraints

- For agentic workers: implement task-by-task; steps use checkbox syntax.
- All edits under `.obsidian/plugins/st-translate-block/` only (the plugin directory at the time).
- Tests deferred (project rule at the time: no `test/` changes in the same task as `src/`).
- Artifacts in English only
- Work only inside this plugin directory
- Keep Translate + Auto behaviour
- Stacked layout; open in right sidebar by default
- Session-only panel state
- No mixed testcase authoring in this plan

## Implementation steps

### File map

| File                            | Role                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/models.ts`                 | `parseModelList`, `resolveModel`                                    |
| `src/translate-workspace.ts`    | Shared UI mount + state handle                                      |
| `src/translate-panel-view.ts`   | `ItemView` host                                                     |
| `src/settings.ts`               | `modelsRaw`, models textarea, default model dropdown                |
| `src/main.ts`                   | Register view/ribbon/command; refactor block to workspace; registry |
| `src/styles.css` / `styles.css` | Panel leaf spacing if needed                                        |
| `README.md`                     | Document panel + model list                                         |

Tasks 1–5 are ticked from commit `0a044fe` (2026-07-22), which added or changed every file in this map and rebuilt `main.js`.

### Task 1: Model list helpers + settings

**Files:** Create `src/models.ts`; Modify `src/settings.ts`

- [x] Add `parseModelList` / `resolveModel` in `src/models.ts`
- [x] Add `modelsRaw` to settings + DEFAULT_SETTINGS (`"llama3"`)
- [x] Settings UI: Models textarea; Default model dropdown; sync default when list changes

### Task 2: TranslateWorkspace

**Files:** Create `src/translate-workspace.ts`

- [x] Mount stacked UI (langs, model select, Translate, Auto, optional Save)
- [x] Expose handle: state getters, destroy, refreshModelOptions
- [x] Wire Translate → plugin job; Auto → mode on shared state

### Task 3: Panel view + plugin wiring

**Files:** Create `src/translate-panel-view.ts`; Modify `src/main.ts`

- [x] `TranslatePanelView` mounts workspace on open, unregisters on close
- [x] Register view, ribbon, command; open in right leaf
- [x] Refactor `processTranslateBlock` to mount workspace
- [x] Registry + poll/run jobs over all workspaces

### Task 4: Styles + README

**Files:** Modify `src/styles.css`, `styles.css`, `README.md`

- [x] Panel container polish if needed
- [x] Document Open Translate Panel + Models setting

## Validation

### Task 5: Build verify

- [x] `npm run build` in plugin root; fix TypeScript errors

- Evidence: `0a044fe` includes a rebuilt `main.js`; the change was released as 1.1.0 (`94d71dc`, 2026-07-22).
- No automated tests were written for this plan (deferred by its constraints).

## Open decisions

None recorded.
