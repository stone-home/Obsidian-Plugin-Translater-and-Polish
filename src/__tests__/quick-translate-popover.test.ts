import { Modal, Notice } from "obsidian";
import { editorWithSelection, flush, makePlugin, mockBackend } from "../../test/helpers";
import { QuickTranslatePopover } from "../quick-translate-popover";
import type TranslatePolishPlugin from "../main";

const anchor = { left: 100, right: 200, top: 100, bottom: 120 };

describe("QuickTranslatePopover", () => {
	let plugin: TranslatePolishPlugin;
	let complete: jest.SpyInstance;

	beforeEach(async () => {
		plugin = await makePlugin();
		complete = mockBackend(plugin);
	});
	afterEach(() => {
		QuickTranslatePopover.closeCurrent();
		document.body.innerHTML = "";
		Notice.all = [];
		Modal.openInstances = [];
	});

	function open(a = anchor) {
		const editor = editorWithSelection("hello world", { line: 0, ch: 0 }, { line: 0, ch: 5 });
		const popover = QuickTranslatePopover.open(plugin, editor, { line: 0, ch: 0 }, { line: 0, ch: 5 }, "hello", a);
		const el = document.querySelector<HTMLElement>(".translate-popover")!;
		return { popover, el, editor };
	}

	const body = (el: HTMLElement) => el.querySelector(".translate-popover-body")!;
	const status = (el: HTMLElement) => el.querySelector(".translate-popover-status")!;

	it("shows the translation first and fetches the rewrite only on demand", async () => {
		const { el } = open();
		expect(status(el).textContent).toBe("Translating…");
		expect(el.style.left).toBe("100px");
		expect(el.style.top).toBe("126px");
		await flush();
		expect(body(el).textContent).toBe("Direct text.");
		expect(status(el).getAttribute("style")).toContain("none");
		expect(complete).toHaveBeenCalledTimes(1);

		const select = el.querySelector<HTMLSelectElement>("select")!;
		select.value = "native";
		select.dispatchEvent(new Event("change"));
		expect(body(el).textContent).toBe("—");
		expect(status(el).textContent).toBe("Rewriting…");
		await flush();
		expect(complete).toHaveBeenCalledTimes(2);
		expect(body(el).textContent).toBe("Native text.");

		select.value = "direct";
		select.dispatchEvent(new Event("change"));
		select.value = "native";
		select.dispatchEvent(new Event("change"));
		await flush();
		expect(complete).toHaveBeenCalledTimes(2);
		expect(plugin.app.keymap.stack).toHaveLength(1);
	});

	it("flips above the anchor near the bottom and clamps to the viewport", () => {
		const { el } = open({ left: -50, right: 0, top: window.innerHeight - 20, bottom: window.innerHeight - 10 });
		expect(el.style.left).toBe("8px");
		expect(parseInt(el.style.top, 10)).toBe(window.innerHeight - 20 - 150 - 6);
		const { el: far } = open({ left: 5000, right: 5000, top: 2, bottom: 4 });
		expect(parseInt(far.style.left, 10)).toBe(window.innerWidth - 400 - 8);
		expect(parseInt(far.style.top, 10)).toBe(10);
	});

	it("shows errors per task", async () => {
		complete.mockRestore();
		mockBackend(plugin, new Error("HTTP 401"), new Error("HTTP 400"));
		const { el } = open();
		await flush();
		expect(status(el).textContent).toContain("HTTP 401");
		expect(status(el).hasClass("is-error")).toBe(true);
		expect(body(el).textContent).toBe("—");
		const select = el.querySelector<HTMLSelectElement>("select")!;
		select.value = "native";
		select.dispatchEvent(new Event("change"));
		await flush();
		expect(status(el).textContent).toContain("Native rewrite failed: HTTP 400");
	});

	it("copies and opens the full window", async () => {
		const { el } = open();
		await flush();
		el.querySelector<HTMLButtonElement>('[aria-label="Copy"]')!.click();
		await flush();
		expect((navigator.clipboard.writeText as jest.Mock).mock.calls.pop()[0]).toBe("Direct text.");
		el.querySelector<HTMLButtonElement>('[aria-label="Open in translate window"]')!.click();
		expect(document.querySelector(".translate-popover")).toBeNull();
		expect(Modal.openInstances).toHaveLength(1);
		expect(Modal.openInstances[0].contentEl.querySelector("textarea")!.value).toBe("hello");
	});

	it("ignores copy before a result and closes via the X button", async () => {
		const { el, popover } = open();
		(navigator.clipboard.writeText as jest.Mock).mockClear();
		el.querySelector<HTMLButtonElement>('[aria-label="Copy"]')!.click();
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
		el.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
		expect(document.querySelector(".translate-popover")).toBeNull();
		popover.close();
		expect(plugin.app.keymap.stack).toHaveLength(0);
	});

	it("closes on Escape, outside click, scroll, resize and leaf change, but not inside interactions", async () => {
		const { el, popover } = open();
		el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		body(el).dispatchEvent(new Event("scroll", { bubbles: true }));
		expect(document.querySelector(".translate-popover")).not.toBeNull();
		expect((popover as any).scope.fire("Escape")).toBe(true);
		expect(document.querySelector(".translate-popover")).toBeNull();

		open();
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(document.querySelector(".translate-popover")).toBeNull();

		open();
		document.dispatchEvent(new Event("scroll"));
		expect(document.querySelector(".translate-popover")).toBeNull();

		open();
		window.dispatchEvent(new Event("resize"));
		expect(document.querySelector(".translate-popover")).toBeNull();

		open();
		plugin.app.workspace.trigger("active-leaf-change", null);
		expect(document.querySelector(".translate-popover")).toBeNull();
		expect(plugin.app.workspace.listenerCount("active-leaf-change")).toBe(0);
	});

	it("drops a late result after closing", async () => {
		let resolve: (r: string) => void = () => undefined;
		complete.mockImplementationOnce(() => new Promise<string>((res) => (resolve = res)));
		const { popover, el } = open();
		popover.close();
		resolve("late");
		await flush();
		expect(body(el).textContent).toBe("");
	});

	it("keeps only one popover open", async () => {
		open();
		open();
		expect(document.querySelectorAll(".translate-popover")).toHaveLength(1);
	});
});
