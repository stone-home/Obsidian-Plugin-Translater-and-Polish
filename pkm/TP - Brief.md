# TP Project Brief

Updated: 2026-11-17. This brief indexes project context and decisions; the source files, git history and the user's own decisions remain the evidence for each entry.

## Background and direction

Translate and Polish (`ProjectCode: TP`, plugin id `translate-polish`) is an Obsidian community plugin, written in TypeScript and bundled with esbuild into `main.js`. It translates selected text and rewrites the user's own writing as a native speaker would, using OpenRouter, Open WebUI or a local Ollama server (README). It is an engineering project, not a research project: no hypotheses, datasets or experiments are recorded.

History (verified from git):

- 1.0 (March 2026): a fenced `translate-block` code block with Auto polling and Save to block. See [[TP - Requirement - Translate block]] and [[TP - Requirement - Translate block fence escape and input UX]].
- 1.1.0 (2026-07-22, `94d71dc`): a translate side panel and a shared model list. See [[TP - Requirement - Translate panel and model list]] and [[TP - Plan - Translate panel and model list]].
- 2.0 (`06d9725`, 2026-11-09): selection-based Quick translate popover, Translate and polish window, replace-selection command and context menu; three providers with API keys in `app.secretStorage`; 1.x settings migrated into the Ollama provider. It removed the code block, side panel and polling. `minAppVersion` is 1.11.4. As of this update no release commit follows `06d9725`, so `manifest.json` and `package.json` still read 1.1.0.

## Definitions and decisions

Repository conventions (user decision, 2026-11-17): the project follows the skills-hub rules recorded in `AGENTS.md`, with profiles `program`, `nodejs` and `obsidian` and the `pm` feature. The objective of the 2026-11-17 alignment was to meet those rules without changing any feature's behaviour.

Layout (user decision, 2026-11-17; `pm-repo-layout`):

- `src/` holds the plugin source; root `main.js`, `manifest.json`, `styles.css` and `versions.json` are the Obsidian release files.
- `tests/unit/` holds the Jest suites and `tests/helpers/` the Obsidian test double, the jsdom setup and typed narrowing helpers.
- `pkm/` holds this brief and the Plan and Requirement documents, named `TP - <Type> - <title>.md`.
- `docs/` is reserved for published software documentation and does not exist yet.
- `playground/` and `.skills-hub/` are git-ignored.

Tooling (verified from `package.json` and config):

- npm is the package manager (`package-lock.json`), Jest with ts-jest and jsdom runs the tests, ESLint uses `eslint-plugin-obsidianmd`, and Prettier formats the code.
- Prettier uses the project's `.prettierrc.json` (single quotes, print width 88, tabs from `.editorconfig`). The assistant applied the existing configuration as the meaning of the user's "规范格式"; a switch to double quotes would be a one-line configuration change.
- Test code has no ESLint exemptions: the eight `@typescript-eslint` type-safety rules that were switched off for tests are on.

Delivery and release (verified): semantic-release on `trunk` runs `npm run version` and attaches `main.js`, `manifest.json` and `styles.css` to the GitHub release. The `release` workflow is started by hand (`workflow_dispatch`).

## Methods and validation basis

Engineering acceptance criteria for any change (from the project scripts and the `nodejs-develop` checks):

- `npm run lint` reports no errors.
- `npm run typecheck` exits 0; it type-checks `src/` and `tests/` through `tsconfig.eslint.json`.
- `npm test` passes, and the coverage thresholds in `jest.config.cjs` hold (statements 85, branches 75, functions 85, lines 85).
- Prettier reports no unformatted files under `src/` and `tests/`.
- `npm run build` succeeds.

Production changes follow `program-code-development`: a failing test first, a stated root cause for fixes, and separate developer and independent-tester work.

## Evidence and open questions

Measured on 2026-11-17 after the alignment (assistant run, working tree):

- 12 suites, 95/95 tests pass; coverage: statements 98.89%, branches 91.13%, functions 100%, lines 99.6%.
- Lint: 0 errors, 1 warning. Typecheck: 0 errors. Prettier: clean.
- Minified bundles built from the pre-alignment `src/` and the formatted `src/` are byte-identical (SHA-256 `8f81b6bf…`), so production behaviour is unchanged.

Open questions:

- Lint warning `obsidianmd/settings-tab/prefer-setting-definitions` (`src/settings.ts`): settings do not appear in Obsidian 1.13+ settings search. Adopting `getSettingDefinitions()` is a feature change; any `minAppVersion` change needs evidence that a newer API is required.
- The repository URL disagrees: `.releaserc` names `stone-home/Obsidian-Plugin-Translater-and-Polish`, while the git remote, `package.json` and `manifest.json` `authorUrl` name `stone-home/Obsidian-Plugin-Translate-Code-Block`.
- A read-only review on 2026-11-17 recorded 15 findings in `src/`, all left untouched because the alignment kept behaviour fixed. The review judged six could be fixed with no behaviour change: unchecked casts at `model-picker.ts:13`, `quick-translate-popover.ts:121` and `:80`, and `translation-backend.ts:179`; definite-assignment `!:` fields in `quick-translate-popover.ts` and `translate-modal.ts`; and the `activeWindow` resize listener in `quick-translate-popover.ts:158`. The others change behaviour:
    - unhandled save and clipboard failures (`settings.ts:70`, `quick-translate-popover.ts:132`);
    - result-handler errors reported as backend failures (`translation-job.ts:109`);
    - a floating promise in `main.ts:104`;
    - sequential model fetching (`main.ts:251`);
    - a run scheduled after the modal closes (`translate-modal.ts:198`).
- The convention has no retired status for Plans or Requirements; [[TP - Requirement - Translate block]] stays `in-progress` until the user decides.
- `.husky` is git-ignored, so the `lint-staged` pre-commit hook is not versioned. No skills-hub rule requires it; the user has not decided to track it.

## Sources and change basis

- Git history to `aa8b8fc` (2026-11-09) on `trunk`; feature commits `5ee62fd`, `97dbaf5`, `24ddf2a`, `0a044fe`, `06d9725`.
- `README.md`, `package.json`, `manifest.json`, `.releaserc`, `jest.config.cjs`, `eslint.config.mts` in the working tree of 2026-11-17.
- 2026-11-17: brief created; layout, formatting, ESLint test rules and the PKM documents aligned with the skills-hub rules (user request).
