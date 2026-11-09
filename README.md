# Obsidian Translate Block

Translate and polish selected text inside Obsidian using **OpenRouter**, **Open WebUI** or a local **Ollama** server.

Select text in a note, then either peek at a translation in a small bubble or open the translate & polish window to rewrite the text and put the result back into the note.

## Features

- **Quick translate** — a read-only bubble next to the selection. Switch between the direct translation and the native-speaker version, copy it, or jump to the full window. Esc, clicking outside, scrolling or changing panes closes it.
- **Translate & polish window** — a centered workbench with a scratchpad on the left that re-translates as you pause typing, and three results on the right: *Native polish*, *Direct translation* and *Suggestions*. Pick a result and **Replace selection** / **Insert at cursor**, **Insert as callout**, or **Copy**. `Ctrl/Cmd+Enter` translates immediately.
- **Translate and replace selection** — no window; the selection is replaced with the direct translation.
- **Three providers** with one-click model list fetching. API keys live in Obsidian's secret storage, not in the plugin's data file.

## Commands and menu

Right-click a selection to find **Quick translate** and **Translate & polish…** in the editor menu. The command palette offers:

| Command | Needs a selection |
|---|---|
| Quick translate selection | yes |
| Translate & polish selection | yes |
| Open translate & polish window | no (opens with an empty scratchpad) |
| Translate and replace selection | yes |

Assign hotkeys to them in **Settings → Hotkeys**.

## Settings

- **Active provider** — OpenRouter, Open WebUI or Ollama.
- Per provider: **Base URL** (not for OpenRouter), **API key** (not for Ollama), **Model** dropdown and a **Fetch models** button that fills the dropdown from the server.
- **Default source / target language**.
- **Default prompt** — supports `{{sourceLang}}` and `{{targetLang}}`. The three-section output format (`### DIRECT`, `### NATIVE`, `### SUGGESTIONS`) is appended automatically unless your prompt already contains `### DIRECT`. Replies without those markers are shown as the direct translation.
- **Live translate delay** — pause length before the window re-translates (default 800 ms).
- **Max text size**, **Request timeout**, **Max attempts**, per-provider **Extra headers**, **Debug**.

### Provider endpoints

| Provider | Chat | Models |
|---|---|---|
| Ollama | `{baseUrl}/api/chat` | `{baseUrl}/api/tags` |
| Open WebUI | `{baseUrl}/api/chat/completions` | `{baseUrl}/api/models` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `https://openrouter.ai/api/v1/models` |

## Upgrading from 1.x

Version 2.0 requires Obsidian **1.11.4** or newer and removes the `translate-block` code block and the side panel. Existing ```` ```translate-block ```` fences in your notes are left untouched and render as ordinary code blocks; nothing is deleted.

Settings are migrated automatically: the old endpoint URL and model list become the Ollama provider's base URL and model list, and an `Authorization: Bearer …` line from *Extra headers* is moved into secret storage as the Ollama API key.

## Development

```bash
npm install
npm test        # unit tests for the response parser, settings migration and provider mapping
npm run build   # type-check and bundle main.js / styles.css
```
