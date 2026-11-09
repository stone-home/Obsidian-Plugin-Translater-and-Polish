import { Modal, Notice } from "obsidian";
import { editorWithSelection, flush, makePlugin, result } from "../../test/helpers";
import { QuickTranslatePopover } from "../quick-translate-popover";
import type TranslateBlockPlugin from "../main";

const anchor = { left: 100, right: 200, top: 100, bottom: 120 };

describe("QuickTranslatePopover", () => {
	let plugin: TranslateBlockPlugin;
	let translate: jest.SpyInstance;

	beforeEach(async () => {
		plugin = await makePlugin();
		translate = jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result());
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

	it("renders the direct translation below the anchor and switches variants", async () => {
		const { el } = open();
		expect(el.querySelector(".translate-popover-status")!.textContent).toBe("Translating…");
		expect(el.style.left).toBe("100px");
		expect(el.style.top).toBe("126px");
		await flush();
		expect(el.querySelector(".translate-popover-body")!.textContent).toBe("Direct text.");
		expect(el.querySelector(".translate-popover-status")!.getAttribute("style")).toContain("none");
		const select = el.querySelector<HTMLSelectElement>("select")!;
		select.value = "native";
		select.dispatchEvent(new Event("change"));
		expect(el.querySelector(".translate-popover-body")!.textContent).toBe("Native text.");
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

	it("forces the direct variant when there is no native polish and shows errors", async () => {
		translate.mockResolvedValueOnce(result({ nativePolish: "" }));
		const { el } = open();
		await flush();
		expect(el.querySelector<HTMLSelectElement>("select")!.value).toBe("direct");
		translate.mockRejectedValueOnce(new Error("HTTP 401"));
		const second = open();
		await flush();
		expect(second.el.querySelector(".translate-popover-status")!.textContent).toContain("HTTP 401");
		expect(second.el.querySelector(".translate-popover-status")!.hasClass("is-error")).toBe(true);
		expect(second.el.querySelector(".translate-popover-body")!.textContent).toBe("");
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
		el.querySelector(".translate-popover-body")!.dispatchEvent(new Event("scroll", { bubbles: true }));
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
		let resolve: (r: any) => void = () => undefined;
		translate.mockImplementationOnce(() => new Promise((res) => (resolve = res)));
		const { popover, el } = open();
		popover.close();
		resolve(result());
		await flush();
		expect(el.querySelector(".translate-popover-body")!.textContent).toBe("");
	});

	it("keeps only one popover open", async () => {
		open();
		open();
		expect(document.querySelectorAll(".translate-popover")).toHaveLength(1);
	});
});
