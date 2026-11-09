import { Menu, Modal, Notice } from "obsidian";
import { editorWithSelection, flush, makePlugin, result } from "../../test/helpers";
import { secretId } from "../providers";

describe("TranslateBlockPlugin", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		Notice.all = [];
		Modal.openInstances = [];
	});

	it("migrates legacy data on load and stores the lifted key as a secret", async () => {
		const plugin = await makePlugin({
			endpointUrl: "http://h:1/api/chat",
			modelsRaw: "m1\nm2",
			defaultModel: "m2",
			extraHeadersRaw: "Authorization: Bearer old-key",
		});
		expect(plugin.settings.providers.ollama).toMatchObject({ baseUrl: "http://h:1", selectedModel: "m2" });
		expect(plugin.app.secretStorage.getSecret(secretId("ollama"))).toBe("old-key");
		expect((plugin as any).savedData()).toMatchObject({ settingsVersion: 2 });
		expect(plugin.settingTab).toBeDefined();
		expect(plugin.commands.map((c) => c.id)).toEqual([
			"quick-translate-selection",
			"translate-polish-selection",
			"open-translate-modal",
			"translate-replace-selection",
		]);
	});

	it("does not re-save when the store is already current", async () => {
		const plugin = await makePlugin();
		expect((plugin as any).savedData()).toBeNull();
	});

	it("adds menu items only when text is selected", async () => {
		const plugin = await makePlugin();
		const noSelection = new Menu();
		plugin.app.workspace.trigger("editor-menu", noSelection, editorWithSelection("abc", { line: 0, ch: 1 }, { line: 0, ch: 1 }));
		expect(noSelection.items).toHaveLength(0);

		const menu = new Menu();
		const editor = editorWithSelection("hello world", { line: 0, ch: 0 }, { line: 0, ch: 5 });
		plugin.app.workspace.trigger("editor-menu", menu, editor);
		expect(menu.items.map((i) => i.title)).toEqual(["Quick translate", "Translate & polish…"]);

		jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result());
		menu.items[0].callback?.(new MouseEvent("click", { clientX: 10, clientY: 20 }));
		expect(document.querySelector(".translate-popover")).not.toBeNull();
		menu.items[1].callback?.(undefined);
		expect(document.querySelector(".translate-popover")).toBeNull();
		expect(Modal.openInstances).toHaveLength(1);
	});

	it("gates selection commands on a selection", async () => {
		const plugin = await makePlugin();
		jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result());
		const empty = editorWithSelection("abc", { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const full = editorWithSelection("abc", { line: 0, ch: 0 }, { line: 0, ch: 3 });
		const byId = (id: string) => plugin.commands.find((c) => c.id === id)!;

		expect(byId("quick-translate-selection").editorCheckCallback!(true, empty, null)).toBe(false);
		expect(byId("quick-translate-selection").editorCheckCallback!(true, full, null)).toBe(true);
		expect(document.querySelector(".translate-popover")).toBeNull();
		byId("quick-translate-selection").editorCheckCallback!(false, full, null);
		expect(document.querySelector(".translate-popover")).not.toBeNull();

		expect(byId("translate-polish-selection").editorCheckCallback!(true, empty, null)).toBe(false);
		byId("translate-polish-selection").editorCheckCallback!(false, full, null);
		expect(Modal.openInstances).toHaveLength(1);

		byId("open-translate-modal").editorCallback!(empty, null);
		expect(Modal.openInstances).toHaveLength(2);

		expect(byId("translate-replace-selection").editorCheckCallback!(true, empty, null)).toBe(false);
		expect(byId("translate-replace-selection").editorCheckCallback!(false, full, null)).toBe(true);
		await flush();
		expect(full.getValue()).toBe("Direct text.");
	});

	it("replaces the selection in place and reports failures", async () => {
		const plugin = await makePlugin();
		const translate = jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result({ directTranslation: "X" }));
		const editor = editorWithSelection("ab cd", { line: 0, ch: 3 }, { line: 0, ch: 5 });
		await plugin.translateAndReplaceSelection(editor);
		expect(editor.getValue()).toBe("ab X");
		expect(Notice.all[0].hidden).toBe(true);

		const unchanged = editorWithSelection("ab cd", { line: 0, ch: 0 }, { line: 0, ch: 2 });
		translate.mockImplementation(async () => {
			unchanged.replaceRange("zz", { line: 0, ch: 0 }, { line: 0, ch: 2 });
			return result();
		});
		await plugin.translateAndReplaceSelection(unchanged);
		expect(unchanged.getValue()).toBe("zz cd");
		expect(Notice.all.some((n) => n.message.includes("nothing was replaced"))).toBe(true);

		jest.useFakeTimers();
		translate.mockRejectedValue(new Error("HTTP 401: no"));
		const failing = editorWithSelection("ab", { line: 0, ch: 0 }, { line: 0, ch: 2 });
		await plugin.translateAndReplaceSelection(failing);
		const notice = Notice.all[Notice.all.length - 1];
		expect(notice.message).toContain("HTTP 401");
		jest.advanceTimersByTime(6000);
		expect(notice.hidden).toBe(true);
		jest.useRealTimers();

		await plugin.translateAndReplaceSelection(editorWithSelection("ab", { line: 0, ch: 1 }, { line: 0, ch: 1 }));
	});

	it("fetches and stores models, clearing the selection when none come back", async () => {
		const plugin = await makePlugin();
		const list = jest.spyOn(plugin.getBackend(), "listModels").mockResolvedValue(["b", "a"]);
		await expect(plugin.fetchModels("openrouter")).resolves.toEqual(["b", "a"]);
		expect(plugin.settings.providers.openrouter.selectedModel).toBe("b");
		expect(list.mock.calls[0][0]).toMatchObject({ provider: "openrouter", apiKey: "" });
		list.mockResolvedValue([]);
		await plugin.fetchModels("openrouter");
		expect(plugin.settings.providers.openrouter.selectedModel).toBe("");
	});

	it("keeps API keys in secret storage and never sends one for Ollama", async () => {
		const plugin = await makePlugin();
		plugin.setApiKey("openrouter", "sk-x");
		plugin.setApiKey("ollama", "leaked");
		expect(plugin.getApiKey("openrouter")).toBe("sk-x");
		expect(plugin.buildProviderRequest("openrouter").apiKey).toBe("sk-x");
		expect(plugin.buildProviderRequest("ollama").apiKey).toBe("");
		jest.spyOn(plugin.app.secretStorage, "setSecret").mockImplementation(() => {
			throw new Error("locked");
		});
		plugin.setApiKey("openwebui", "k");
		expect(Notice.all[0].message).toContain("locked");
	});

	it("normalises settings on save", async () => {
		const plugin = await makePlugin();
		plugin.settings.defaultSourceLang = "bogus";
		plugin.settings.providers.ollama.selectedModel = "missing";
		await plugin.saveSettings();
		expect(plugin.settings.defaultSourceLang).toBe("auto");
		expect(plugin.settings.providers.ollama.selectedModel).toBe("llama3");
	});

	it("closes popover and modals on unload", async () => {
		const plugin = await makePlugin();
		jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result());
		const editor = editorWithSelection("hello", { line: 0, ch: 0 }, { line: 0, ch: 5 });
		plugin.openQuickTranslate(editor);
		plugin.openQuickTranslate(editorWithSelection("x", { line: 0, ch: 0 }, { line: 0, ch: 0 }));
		const modalEditor = editorWithSelection("hello", { line: 0, ch: 0 }, { line: 0, ch: 5 });
		const plugin2 = plugin;
		plugin2.commands.find((c) => c.id === "open-translate-modal")!.editorCallback!(modalEditor, null);
		expect(Modal.openInstances).toHaveLength(1);
		plugin.onunload();
		expect(document.querySelector(".translate-popover")).toBeNull();
		expect(Modal.openInstances).toHaveLength(0);
	});

	it("anchors the popover to the DOM selection when it has a size", async () => {
		const plugin = await makePlugin();
		jest.spyOn(plugin.getBackend(), "translate").mockResolvedValue(result());
		const range: any = document.createRange();
		range.getBoundingClientRect = () => ({ left: 100, right: 200, top: 50, bottom: 70, width: 100, height: 20 });
		jest.spyOn(window, "getSelection").mockReturnValue({ rangeCount: 1, getRangeAt: () => range } as unknown as Selection);
		plugin.openQuickTranslate(editorWithSelection("hello", { line: 0, ch: 0 }, { line: 0, ch: 5 }));
		const el = document.querySelector<HTMLElement>(".translate-popover")!;
		expect(el.style.left).toBe("100px");
		expect(el.style.top).toBe("76px");
	});
});
