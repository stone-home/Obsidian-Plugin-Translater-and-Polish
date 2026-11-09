/**
 * Test double for the `obsidian` package: just enough behaviour for the plugin's
 * UI modules to run under jsdom. Mirrors the public API shapes used in src/.
 */

export const requestUrl = jest.fn();

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute("data-icon", icon);
}

export class Notice {
	static all: Notice[] = [];
	message: string;
	hidden = false;
	constructor(message: string, public duration?: number) {
		this.message = message;
		Notice.all.push(this);
	}
	setMessage(message: string): this {
		this.message = message;
		return this;
	}
	hide(): void {
		this.hidden = true;
	}
}

export type Debouncer<T extends unknown[], V> = ((...args: T) => void) & { cancel(): void; run(): V | undefined };

export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: T | undefined;
	const fn = ((...args: T) => {
		pending = args;
		if (timer && !resetTimer) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			const a = pending as T;
			pending = undefined;
			cb(...a);
		}, timeout);
	}) as Debouncer<T, V>;
	fn.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		pending = undefined;
	};
	fn.run = () => {
		if (!timer) return undefined;
		clearTimeout(timer);
		timer = undefined;
		const a = pending as T;
		pending = undefined;
		return cb(...a);
	};
	return fn;
}

export class Events {
	private handlers = new Map<string, Set<(...args: any[]) => any>>();
	on(name: string, cb: (...args: any[]) => any): EventRef {
		if (!this.handlers.has(name)) this.handlers.set(name, new Set());
		this.handlers.get(name)!.add(cb);
		return { name, cb };
	}
	offref(ref: EventRef): void {
		this.handlers.get(ref.name)?.delete(ref.cb);
	}
	trigger(name: string, ...args: any[]): void {
		for (const cb of Array.from(this.handlers.get(name) ?? [])) cb(...args);
	}
	listenerCount(name: string): number {
		return this.handlers.get(name)?.size ?? 0;
	}
}

export interface EventRef {
	name: string;
	cb: (...args: any[]) => any;
}

export class Scope {
	keys: Array<{ modifiers: string[]; key: string; func: () => any }> = [];
	constructor(public parent?: Scope) {}
	register(modifiers: string[], key: string, func: () => any): void {
		this.keys.push({ modifiers, key, func });
	}
	/** Test helper: fire a registered key. */
	fire(key: string, modifiers: string[] = []): boolean {
		const hit = this.keys.find((k) => k.key === key && k.modifiers.join() === modifiers.join());
		if (!hit) return false;
		hit.func();
		return true;
	}
}

export class Keymap {
	stack: Scope[] = [];
	pushScope(scope: Scope): void {
		this.stack.push(scope);
	}
	popScope(scope: Scope): void {
		this.stack = this.stack.filter((s) => s !== scope);
	}
}

export class SecretStorage extends Events {
	private store = new Map<string, string>();
	setSecret(id: string, secret: string): void {
		if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid secret ID");
		this.store.set(id, secret);
	}
	getSecret(id: string): string | null {
		return this.store.has(id) ? this.store.get(id)! : null;
	}
	listSecrets(): string[] {
		return Array.from(this.store.keys());
	}
}

export class Workspace extends Events {}

export class App {
	scope = new Scope();
	keymap = new Keymap();
	workspace = new Workspace();
	secretStorage = new SecretStorage();
}

export class MenuItem {
	title = "";
	icon: string | null = null;
	section = "";
	callback: ((evt: any) => any) | undefined;
	setTitle(title: string): this {
		this.title = title;
		return this;
	}
	setIcon(icon: string | null): this {
		this.icon = icon;
		return this;
	}
	setSection(section: string): this {
		this.section = section;
		return this;
	}
	onClick(cb: (evt: any) => any): this {
		this.callback = cb;
		return this;
	}
}

export class Menu {
	items: MenuItem[] = [];
	addItem(cb: (item: MenuItem) => any): this {
		const item = new MenuItem();
		cb(item);
		this.items.push(item);
		return this;
	}
}

export class Modal {
	static openInstances: Modal[] = [];
	scope = new Scope();
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	shouldRestoreSelection = true;
	isOpen = false;
	constructor(public app: App) {
		this.containerEl = document.body.createDiv({ cls: "modal-container" });
		this.modalEl = this.containerEl.createDiv({ cls: "modal" });
		this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
		this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
	}
	open(): void {
		this.isOpen = true;
		Modal.openInstances.push(this);
		void this.onOpen();
	}
	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		Modal.openInstances = Modal.openInstances.filter((m) => m !== this);
		this.onClose();
		this.containerEl.remove();
	}
	onOpen(): Promise<void> | void {}
	onClose(): void {}
	setTitle(title: string): this {
		this.titleEl.setText(title);
		return this;
	}
	setContent(content: string): this {
		this.contentEl.setText(content);
		return this;
	}
}

export abstract class BaseComponent {
	disabled = false;
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
}

export class TextComponent extends BaseComponent {
	inputEl: HTMLInputElement;
	private cb: ((value: string) => any) | undefined;
	constructor(containerEl: HTMLElement) {
		super();
		this.inputEl = containerEl.createEl("input", { type: "text" });
		this.inputEl.addEventListener("input", () => this.cb?.(this.inputEl.value));
	}
	setPlaceholder(p: string): this {
		this.inputEl.placeholder = p;
		return this;
	}
	setValue(v: string): this {
		this.inputEl.value = v;
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	onChange(cb: (value: string) => any): this {
		this.cb = cb;
		return this;
	}
}

export class TextAreaComponent extends BaseComponent {
	inputEl: HTMLTextAreaElement;
	private cb: ((value: string) => any) | undefined;
	constructor(containerEl: HTMLElement) {
		super();
		this.inputEl = containerEl.createEl("textarea");
		this.inputEl.addEventListener("input", () => this.cb?.(this.inputEl.value));
	}
	setPlaceholder(p: string): this {
		this.inputEl.placeholder = p;
		return this;
	}
	setValue(v: string): this {
		this.inputEl.value = v;
		return this;
	}
	onChange(cb: (value: string) => any): this {
		this.cb = cb;
		return this;
	}
}

export class DropdownComponent extends BaseComponent {
	selectEl: HTMLSelectElement;
	private cb: ((value: string) => any) | undefined;
	constructor(containerEl: HTMLElement) {
		super();
		this.selectEl = containerEl.createEl("select");
		this.selectEl.addEventListener("change", () => this.cb?.(this.selectEl.value));
	}
	addOption(value: string, display: string): this {
		this.selectEl.createEl("option", { text: display }).value = value;
		return this;
	}
	setValue(v: string): this {
		this.selectEl.value = v;
		return this;
	}
	getValue(): string {
		return this.selectEl.value;
	}
	onChange(cb: (value: string) => any): this {
		this.cb = cb;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.selectEl.disabled = disabled;
		return super.setDisabled(disabled);
	}
}

export class ToggleComponent extends BaseComponent {
	toggleEl: HTMLElement;
	value = false;
	private cb: ((value: boolean) => any) | undefined;
	constructor(containerEl: HTMLElement) {
		super();
		this.toggleEl = containerEl.createDiv({ cls: "checkbox-container" });
		this.toggleEl.addEventListener("click", () => {
			this.value = !this.value;
			this.cb?.(this.value);
		});
	}
	setValue(v: boolean): this {
		this.value = v;
		return this;
	}
	onChange(cb: (value: boolean) => any): this {
		this.cb = cb;
		return this;
	}
}

export class ButtonComponent extends BaseComponent {
	buttonEl: HTMLButtonElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.buttonEl = containerEl.createEl("button");
	}
	setButtonText(text: string): this {
		this.buttonEl.setText(text);
		return this;
	}
	setCta(): this {
		return this;
	}
	onClick(cb: () => any): this {
		this.buttonEl.addEventListener("click", cb);
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.buttonEl.disabled = disabled;
		return super.setDisabled(disabled);
	}
}

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: BaseComponent[] = [];
	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		const info = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = info.createDiv({ cls: "setting-item-name" });
		this.descEl = info.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}
	setName(name: string): this {
		this.nameEl.setText(name);
		return this;
	}
	setDesc(desc: string): this {
		this.descEl.setText(desc);
		return this;
	}
	setClass(cls: string): this {
		this.settingEl.addClass(cls);
		return this;
	}
	setHeading(): this {
		this.settingEl.addClass("setting-item-heading");
		return this;
	}
	private add<T extends BaseComponent>(component: T, cb: (c: T) => any): this {
		this.components.push(component);
		cb(component);
		return this;
	}
	addText(cb: (c: TextComponent) => any): this {
		return this.add(new TextComponent(this.controlEl), cb);
	}
	addTextArea(cb: (c: TextAreaComponent) => any): this {
		return this.add(new TextAreaComponent(this.controlEl), cb);
	}
	addDropdown(cb: (c: DropdownComponent) => any): this {
		return this.add(new DropdownComponent(this.controlEl), cb);
	}
	addToggle(cb: (c: ToggleComponent) => any): this {
		return this.add(new ToggleComponent(this.controlEl), cb);
	}
	addButton(cb: (c: ButtonComponent) => any): this {
		return this.add(new ButtonComponent(this.controlEl), cb);
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement;
	constructor(public app: App, public plugin: any) {
		this.containerEl = document.body.createDiv({ cls: "vertical-tab-content" });
	}
	display(): void {}
	hide(): void {}
}

export interface Command {
	id: string;
	name: string;
	callback?: () => any;
	editorCallback?: (editor: any, ctx: any) => any;
	editorCheckCallback?: (checking: boolean, editor: any, ctx: any) => boolean | void;
}

export class Plugin {
	commands: Command[] = [];
	settingTab: PluginSettingTab | undefined;
	eventRefs: EventRef[] = [];
	private data: unknown = null;
	constructor(public app: App, public manifest: any = { id: "test" }) {}
	async loadData(): Promise<unknown> {
		return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
	}
	async saveData(data: unknown): Promise<void> {
		this.data = JSON.parse(JSON.stringify(data));
	}
	/** Test helper: seed data.json. */
	seedData(data: unknown): void {
		this.data = data;
	}
	savedData(): unknown {
		return this.data;
	}
	addCommand(command: Command): Command {
		this.commands.push(command);
		return command;
	}
	addSettingTab(tab: PluginSettingTab): void {
		this.settingTab = tab;
	}
	registerEvent(ref: EventRef): void {
		this.eventRefs.push(ref);
	}
	registerInterval(id: number): number {
		return id;
	}
	registerDomEvent(): void {}
}

/** Minimal in-memory Editor for write-back tests. Positions are {line, ch}. */
export class Editor {
	lines: string[];
	selFrom = { line: 0, ch: 0 };
	selTo = { line: 0, ch: 0 };
	constructor(text = "") {
		this.lines = text.split("\n");
	}
	getValue(): string {
		return this.lines.join("\n");
	}
	getLine(n: number): string {
		return this.lines[n];
	}
	setSelection(from: { line: number; ch: number }, to: { line: number; ch: number }): void {
		this.selFrom = from;
		this.selTo = to;
	}
	somethingSelected(): boolean {
		return this.selFrom.line !== this.selTo.line || this.selFrom.ch !== this.selTo.ch;
	}
	getSelection(): string {
		return this.getRange(this.selFrom, this.selTo);
	}
	getCursor(side?: "from" | "to" | "head" | "anchor"): { line: number; ch: number } {
		return side === "from" ? { ...this.selFrom } : { ...this.selTo };
	}
	private offset(pos: { line: number; ch: number }): number {
		let n = 0;
		for (let i = 0; i < pos.line; i += 1) n += this.lines[i].length + 1;
		return n + pos.ch;
	}
	getRange(from: { line: number; ch: number }, to: { line: number; ch: number }): string {
		return this.getValue().slice(this.offset(from), this.offset(to));
	}
	replaceRange(text: string, from: { line: number; ch: number }, to?: { line: number; ch: number }): void {
		const value = this.getValue();
		const a = this.offset(from);
		const b = to ? this.offset(to) : a;
		this.lines = (value.slice(0, a) + text + value.slice(b)).split("\n");
	}
	replaceSelection(text: string): void {
		this.replaceRange(text, this.selFrom, this.selTo);
	}
}

export class MarkdownView {}
