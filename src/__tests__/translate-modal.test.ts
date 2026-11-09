import { Modal, Notice } from "obsidian";
import { REWRITE_REPLY, editorWithSelection, flush, makePlugin, mockBackend } from "../../test/helpers";
import { TranslateModal, buildCallout } from "../translate-modal";
import type TranslateBlockPlugin from "../main";

function fire(el: HTMLElement, type: string): void {
	el.dispatchEvent(new Event(type, { bubbles: true }));
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
	const hit = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
	if (!hit) throw new Error(`button ${text} not found`);
	return hit;
}

const nativeBody = (root: HTMLElement) => root.querySelector(".translate-card--native .translate-card-body")!;
const directBody = (root: HTMLElement) => root.querySelector(".translate-card--direct .translate-card-body")!;

describe("buildCallout", () => {
	it("quotes every line under a translate callout header", () => {
		expect(buildCallout("a\nb", "en")).toBe("> [!translate] en\n> a\n> b");
	});
});

describe("TranslateModal", () => {
	let plugin: TranslateBlockPlugin;
	let complete: jest.SpyInstance;

	beforeEach(async () => {
		plugin = await makePlugin();
		complete = mockBackend(plugin);
	});
	afterEach(() => {
		document.body.innerHTML = "";
		Notice.all = [];
		Modal.openInstances = [];
		jest.useRealTimers();
	});

	function openWithSelection(text = "hello world", from = { line: 0, ch: 0 }, to = { line: 0, ch: 5 }) {
		const editor = editorWithSelection(text, from, to);
		const modal = new TranslateModal(plugin.app, plugin, editor, from, to, editor.getSelection());
		modal.open();
		return { editor, modal, root: modal.contentEl };
	}

	it("runs both tasks on open and renders all sections", async () => {
		const { modal, root } = openWithSelection();
		expect(modal.modalEl.hasClass("translate-modal")).toBe(true);
		expect(modal.titleEl.textContent).toBe("Translate & polish");
		await flush();
		expect(complete).toHaveBeenCalledTimes(2);
		expect(nativeBody(root).textContent).toBe("Native text.");
		expect(directBody(root).textContent).toBe("Direct text.");
		expect(root.querySelector(".translate-suggestions summary")!.textContent).toBe("What changed (1)");
		expect(root.querySelector(".translate-modal-status")!.textContent).toMatch(/Done in .* s · 5 chars/);
		expect(root.querySelector(".translate-card--native")!.hasClass("is-selected")).toBe(true);
		expect(buttonByText(root, "Replace selection").disabled).toBe(false);
	});

	it("replaces the selection with the chosen card and closes", async () => {
		const { editor, modal, root } = openWithSelection();
		await flush();
		buttonByText(root, "Replace selection").click();
		expect(editor.getValue()).toBe("Native text. world");
		expect(modal.isOpen).toBe(false);
	});

	it("lets the user pick the translation card", async () => {
		const { editor, root } = openWithSelection();
		await flush();
		root.querySelectorAll<HTMLButtonElement>(".translate-card-use")[1].click();
		expect(root.querySelector(".translate-card--direct")!.hasClass("is-selected")).toBe(true);
		buttonByText(root, "Replace selection").click();
		expect(editor.getValue()).toBe("Direct text. world");
	});

	it("inserts a callout after the selected lines, handling a column-0 end", async () => {
		const { editor, root } = openWithSelection("line one\nline two\nline three", { line: 0, ch: 0 }, { line: 2, ch: 0 });
		await flush();
		buttonByText(root, "Insert as callout").click();
		expect(editor.getValue()).toBe("line one\nline two\n> [!translate] auto\n> Native text.\nline three");

		const second = openWithSelection("abc\ndef", { line: 0, ch: 1 }, { line: 0, ch: 3 });
		await flush();
		second.root.querySelectorAll<HTMLButtonElement>(".translate-card-use")[1].click();
		buttonByText(second.root, "Insert as callout").click();
		expect(second.editor.getValue()).toBe("abc\n> [!translate] en\n> Direct text.\ndef");
	});

	it("falls back to the cursor when the selection changed meanwhile", async () => {
		const { editor, root } = openWithSelection();
		await flush();
		editor.replaceRange("X", { line: 0, ch: 0 }, { line: 0, ch: 5 });
		editor.setSelection({ line: 0, ch: 7 }, { line: 0, ch: 7 });
		buttonByText(root, "Replace selection").click();
		expect(editor.getValue()).toBe("X worldNative text.");
		expect(Notice.all[0].message).toContain("Selection changed");
	});

	it("inserts at the cursor when opened without a selection, plain and as callout", async () => {
		const editor = editorWithSelection("ab", { line: 0, ch: 1 }, { line: 0, ch: 1 });
		const modal = new TranslateModal(plugin.app, plugin, editor, { line: 0, ch: 1 }, { line: 0, ch: 1 }, "");
		modal.open();
		const root = modal.contentEl;
		expect(root.querySelector(".translate-modal-status")!.textContent).toContain("Type or paste");
		expect(buttonByText(root, "Insert at cursor").disabled).toBe(true);
		const textarea = root.querySelector("textarea")!;
		textarea.value = "typed";
		fire(textarea, "input");
		(modal as any).scheduleRun.run();
		await flush();
		buttonByText(root, "Insert at cursor").click();
		expect(editor.getValue()).toBe("aNative text.b");

		const again = new TranslateModal(plugin.app, plugin, editor, { line: 0, ch: 0 }, { line: 0, ch: 0 }, "");
		again.open();
		again.contentEl.querySelector("textarea")!.value = "typed";
		await (again as any).run();
		buttonByText(again.contentEl, "Insert as callout").click();
		expect(editor.getValue().startsWith("\n> [!translate] auto\n> Native text.\n")).toBe(true);
	});

	it("copies the chosen text", async () => {
		const { root } = openWithSelection();
		await flush();
		buttonByText(root, "Copy").click();
		await flush();
		expect((navigator.clipboard.writeText as jest.Mock).mock.calls.pop()[0]).toBe("Native text.");
		expect(Notice.all.pop()!.message).toBe("Copied to clipboard.");
	});

	it("debounces typing, clears on empty input and runs on Mod+Enter", async () => {
		jest.useFakeTimers();
		const { modal, root } = openWithSelection();
		await Promise.resolve();
		complete.mockClear();
		const textarea = root.querySelector("textarea")!;
		textarea.value = "new text";
		fire(textarea, "input");
		jest.advanceTimersByTime(300);
		expect(complete).not.toHaveBeenCalled();
		jest.advanceTimersByTime(600);
		expect(complete).toHaveBeenCalledTimes(2);

		textarea.value = "";
		fire(textarea, "input");
		expect(root.querySelector(".translate-modal-status")!.textContent).toBe("Waiting for text.");

		textarea.value = "again";
		expect(modal.scope.fire("Enter", ["Mod"])).toBe(true);
		expect(complete).toHaveBeenCalledTimes(4);
		buttonByText(root, "Run now").click();
		expect(complete).toHaveBeenCalledTimes(6);
	});

	it("drops stale responses and shows per-card errors", async () => {
		const { root, modal } = openWithSelection();
		await flush();
		let resolveSlow: (r: string) => void = () => undefined;
		complete.mockImplementationOnce(() => new Promise<string>((res) => (resolveSlow = res)));
		complete.mockImplementationOnce(async () => "### NATIVE\nslow native");
		(modal as any).run();
		complete.mockImplementationOnce(async () => "fast").mockImplementationOnce(async () => "### NATIVE\nfast native\n### SUGGESTIONS\n- none");
		(modal as any).run();
		await flush();
		expect(directBody(root).textContent).toBe("fast");
		expect(nativeBody(root).textContent).toBe("fast native");
		expect(root.querySelector(".translate-suggestions")!.getAttribute("style")).toContain("none");
		resolveSlow("slow");
		await flush();
		expect(directBody(root).textContent).toBe("fast");

		complete.mockImplementationOnce(async () => {
			throw new Error("HTTP 401: nope");
		}).mockImplementationOnce(async () => REWRITE_REPLY);
		await (modal as any).run();
		expect(directBody(root).textContent).toContain("HTTP 401");
		expect(nativeBody(root).textContent).toBe("Native text.");
		expect(root.querySelector(".translate-modal-status")!.textContent).toMatch(/Done in/);
	});

	it("moves the highlight to a card that has text", async () => {
		complete.mockRestore();
		mockBackend(plugin, "Only translation", new Error("HTTP 400: rewrite model down"));
		const { root, editor } = openWithSelection();
		await flush();
		expect(root.querySelector(".translate-card--direct")!.hasClass("is-selected")).toBe(true);
		expect(nativeBody(root).textContent).toContain("rewrite model down");
		buttonByText(root, "Replace selection").click();
		expect(editor.getValue()).toBe("Only translation world");
	});

	it("switches task models and languages from the toolbar", async () => {
		plugin.settings.providers.openwebui.models = ["w1", "w2"];
		const { root } = openWithSelection();
		await flush();
		const taskSelects = root.querySelectorAll<HTMLSelectElement>(".translate-modal-task select");
		expect(taskSelects).toHaveLength(2);
		taskSelects[1].value = "openwebui::w2";
		fire(taskSelects[1], "change");
		await flush();
		expect(plugin.settings.tasks.rewrite).toEqual({ provider: "openwebui", model: "w2" });
		expect(plugin.settings.tasks.translate).toEqual({ provider: "ollama", model: "llama3" });

		const langSelects = Array.from(root.querySelectorAll<HTMLSelectElement>(".translate-modal-toolbar > select"));
		const [sourceSelect, targetSelect] = langSelects;
		const swap = root.querySelector<HTMLButtonElement>('[aria-label="Swap languages"]')!;
		swap.click();
		expect(Notice.all[0].message).toContain("source language");
		sourceSelect.value = "zh";
		fire(sourceSelect, "change");
		targetSelect.value = "en";
		fire(targetSelect, "change");
		swap.click();
		expect(sourceSelect.value).toBe("en");
		expect(targetSelect.value).toBe("zh");
	});

	it("refreshes models for all providers from the toolbar", async () => {
		jest.spyOn(plugin.getBackend(), "listModels").mockResolvedValue(["z", "y"]);
		const { root } = openWithSelection();
		await flush();
		const refresh = root.querySelector<HTMLButtonElement>('[aria-label="Fetch models from all providers"]')!;
		refresh.click();
		await flush();
		expect(Notice.all.pop()!.message).toBe("Models fetched. Ollama: 2");
		const options = Array.from(root.querySelectorAll<HTMLOptionElement>(".translate-modal-task select")[0].parentElement!.querySelectorAll("option")).map((o) => o.value);
		expect(options).toEqual(["ollama::z", "ollama::y", "ollama::llama3"]);
		expect(refresh.hasClass("is-loading")).toBe(false);
	});

	it("reports a write-back failure instead of closing", async () => {
		const { editor, modal, root } = openWithSelection();
		await flush();
		jest.spyOn(editor, "replaceRange").mockImplementation(() => {
			throw new Error("view destroyed");
		});
		buttonByText(root, "Replace selection").click();
		expect(modal.isOpen).toBe(true);
		expect(Notice.all[0].message).toContain("view destroyed");
	});

	it("disables write-back buttons without an editor", async () => {
		const modal = new TranslateModal(plugin.app, plugin, null, null, null, "text");
		modal.open();
		await flush();
		expect(buttonByText(modal.contentEl, "Insert at cursor").disabled).toBe(true);
		expect(buttonByText(modal.contentEl, "Copy").disabled).toBe(false);
		buttonByText(modal.contentEl, "Insert at cursor").click();
		expect(modal.isOpen).toBe(true);
	});
});

describe("TranslateModal size persistence", () => {
	beforeEach(() => {
		(globalThis as any).ResizeObserver.reset();
	});
	afterEach(() => {
		document.body.innerHTML = "";
		Modal.openInstances = [];
		(globalThis as any).ResizeObserver.reset();
		jest.useRealTimers();
	});

	it("restores a saved size and stores the size the user drags to", async () => {
		jest.useFakeTimers();
		const plugin = await makePlugin({ settingsVersion: 3, modalWidth: 700, modalHeight: 500 });
		mockBackend(plugin);
		const modal = new TranslateModal(plugin.app, plugin, null, null, null, "");
		modal.open();
		expect(modal.modalEl.style.width).toBe("700px");
		expect(modal.modalEl.style.height).toBe("500px");

		// Default jsdom offsets are 400x150 (see setup-dom); a resize callback should persist them.
		(globalThis as any).ResizeObserver.fire();
		jest.advanceTimersByTime(400);
		await Promise.resolve();
		expect(plugin.settings.modalWidth).toBe(400);
		expect(plugin.settings.modalHeight).toBe(150);
		expect((plugin as any).savedData()).toMatchObject({ modalWidth: 400, modalHeight: 150 });

		modal.close();
		expect((globalThis as any).ResizeObserver.instances).toHaveLength(0);
	});

	it("does nothing without ResizeObserver and ignores the initial observe callback", async () => {
		const original = (globalThis as any).ResizeObserver;
		(globalThis as any).ResizeObserver = undefined;
		const plugin = await makePlugin();
		mockBackend(plugin);
		const modal = new TranslateModal(plugin.app, plugin, null, null, null, "");
		modal.open();
		modal.close();
		expect(plugin.settings.modalWidth).toBeUndefined();
		(globalThis as any).ResizeObserver = original;

		const again = new TranslateModal(plugin.app, plugin, null, null, null, "");
		again.open();
		await flush();
		expect(plugin.settings.modalWidth).toBeUndefined();
		again.close();
	});
});
