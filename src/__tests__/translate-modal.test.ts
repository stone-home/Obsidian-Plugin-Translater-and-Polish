import { Modal, Notice } from "obsidian";
import { editorWithSelection, flush, makePlugin, result } from "../../test/helpers";
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

describe("buildCallout", () => {
	it("quotes every line under a translate callout header", () => {
		expect(buildCallout("a\nb", "en")).toBe("> [!translate] en\n> a\n> b");
	});
});

describe("TranslateModal", () => {
	let plugin: TranslateBlockPlugin;
	let translate: jest.SpyInstance;

	beforeEach(async () => {
		plugin = await makePlugin();
		translate = jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result());
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

	it("translates the selection on open and renders all three sections", async () => {
		const { modal, root } = openWithSelection();
		expect(modal.modalEl.hasClass("translate-modal")).toBe(true);
		expect(modal.titleEl.textContent).toBe("Translate & polish");
		await flush();
		expect(root.querySelector(".translate-card--native .translate-card-body")!.textContent).toBe("Native text.");
		expect(root.querySelector(".translate-card--direct .translate-card-body")!.textContent).toBe("Direct text.");
		expect(root.querySelector(".translate-suggestions summary")!.textContent).toBe("Suggestions (1)");
		expect(root.querySelector(".translate-modal-status")!.textContent).toMatch(/Translated in .* s · 5 chars/);
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

	it("lets the user pick the direct card", async () => {
		const { editor, root } = openWithSelection();
		await flush();
		const useButtons = root.querySelectorAll<HTMLButtonElement>(".translate-card-use");
		useButtons[1].click();
		expect(root.querySelector(".translate-card--direct")!.hasClass("is-selected")).toBe(true);
		buttonByText(root, "Replace selection").click();
		expect(editor.getValue()).toBe("Direct text. world");
	});

	it("inserts a callout after the selected lines, handling a column-0 end", async () => {
		const { editor, root } = openWithSelection("line one\nline two\nline three", { line: 0, ch: 0 }, { line: 2, ch: 0 });
		await flush();
		buttonByText(root, "Insert as callout").click();
		expect(editor.getValue()).toBe("line one\nline two\n> [!translate] en\n> Native text.\nline three");

		const second = openWithSelection("abc\ndef", { line: 0, ch: 1 }, { line: 0, ch: 3 });
		await flush();
		buttonByText(second.root, "Insert as callout").click();
		expect(second.editor.getValue()).toBe("abc\n> [!translate] en\n> Native text.\ndef");
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
		await flush();
		(modal as any).scheduleRun.run();
		await flush();
		buttonByText(root, "Insert at cursor").click();
		expect(editor.getValue()).toBe("aNative text.b");

		const again = new TranslateModal(plugin.app, plugin, editor, { line: 0, ch: 0 }, { line: 0, ch: 0 }, "");
		again.open();
		again.contentEl.querySelector("textarea")!.value = "typed";
		await (again as any).run();
		buttonByText(again.contentEl, "Insert as callout").click();
		expect(editor.getValue().startsWith("\n> [!translate] en\n> Native text.\n")).toBe(true);
	});

	it("copies the chosen text", async () => {
		const { root } = openWithSelection();
		await flush();
		buttonByText(root, "Copy").click();
		await flush();
		expect((navigator.clipboard.writeText as jest.Mock).mock.calls.pop()[0]).toBe("Native text.");
		expect(Notice.all.pop()!.message).toBe("Copied to clipboard.");
	});

	it("debounces typing, clears on empty input and translates on Mod+Enter", async () => {
		jest.useFakeTimers();
		const { modal, root } = openWithSelection();
		await Promise.resolve();
		translate.mockClear();
		const textarea = root.querySelector("textarea")!;
		textarea.value = "new text";
		fire(textarea, "input");
		jest.advanceTimersByTime(300);
		expect(translate).not.toHaveBeenCalled();
		jest.advanceTimersByTime(600);
		expect(translate).toHaveBeenCalledTimes(1);

		textarea.value = "";
		fire(textarea, "input");
		expect(root.querySelector(".translate-modal-status")!.textContent).toBe("Waiting for text.");

		textarea.value = "again";
		expect(modal.scope.fire("Enter", ["Mod"])).toBe(true);
		expect(translate).toHaveBeenCalledTimes(2);
		buttonByText(root, "Translate now").click();
		expect(translate).toHaveBeenCalledTimes(3);
	});

	it("drops stale responses and shows errors", async () => {
		const { root, modal } = openWithSelection();
		await flush();
		let resolveSlow: (r: any) => void = () => undefined;
		translate.mockImplementationOnce(() => new Promise((res) => (resolveSlow = res)));
		translate.mockResolvedValueOnce(result({ directTranslation: "fast", nativeRewrite: "", suggestions: [] }));
		(modal as any).run();
		(modal as any).run();
		await flush();
		expect(root.querySelector(".translate-card--direct .translate-card-body")!.textContent).toBe("fast");
		expect(root.querySelector(".translate-card--direct")!.hasClass("is-selected")).toBe(true);
		resolveSlow(result({ directTranslation: "slow" }));
		await flush();
		expect(root.querySelector(".translate-card--direct .translate-card-body")!.textContent).toBe("fast");
		expect(root.querySelector(".translate-suggestions")!.getAttribute("style")).toContain("none");

		translate.mockRejectedValueOnce(new Error("HTTP 401: nope"));
		await (modal as any).run();
		expect(root.querySelector(".translate-modal-status")!.textContent).toContain("HTTP 401");
	});

	it("switches provider, model and languages from the toolbar", async () => {
		plugin.settings.providers.openwebui.models = ["w1", "w2"];
		plugin.settings.providers.openwebui.selectedModel = "w1";
		const { root } = openWithSelection();
		await flush();
		const selects = root.querySelectorAll<HTMLSelectElement>(".translate-modal-toolbar select");
		const [providerSelect, modelSelect, sourceSelect, targetSelect] = Array.from(selects);
		providerSelect.value = "openwebui";
		fire(providerSelect, "change");
		await flush();
		expect(plugin.settings.activeProvider).toBe("openwebui");
		expect(Array.from(modelSelect.options).map((o) => o.value)).toEqual(["w1", "w2"]);
		modelSelect.value = "w2";
		fire(modelSelect, "change");
		await flush();
		expect(plugin.settings.providers.openwebui.selectedModel).toBe("w2");

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

	it("refreshes models from the toolbar and reports failures", async () => {
		const list = jest.spyOn(plugin.getBackend(), "listModels").mockResolvedValue(["z", "y"]);
		const { root } = openWithSelection();
		await flush();
		const refresh = root.querySelector<HTMLButtonElement>('[aria-label="Fetch models"]')!;
		refresh.click();
		await flush();
		expect(Notice.all.pop()!.message).toBe("Fetched 2 models.");
		expect(Array.from(root.querySelectorAll<HTMLSelectElement>(".translate-modal-model option")).map((o) => o.value)).toEqual(["z", "y"]);
		list.mockRejectedValue(new Error("down"));
		refresh.click();
		await flush();
		expect(Notice.all.pop()!.message).toContain("down");
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
