/**
 * Replicates the DOM helpers Obsidian adds to Node/HTMLElement prototypes so
 * UI modules run under jsdom. Only the helpers used by src/ are implemented.
 */

type DomOpts = { cls?: string; text?: string; attr?: Record<string, string>; type?: string; value?: string };

function applyOpts(el: HTMLElement, opts?: DomOpts | string): void {
	if (!opts) return;
	if (typeof opts === "string") {
		el.className = opts;
		return;
	}
	if (opts.cls) el.className = opts.cls;
	if (opts.text !== undefined) el.textContent = opts.text;
	if (opts.type) (el as HTMLInputElement).type = opts.type;
	if (opts.value !== undefined) (el as HTMLInputElement).value = opts.value;
	if (opts.attr) {
		for (const key of Object.keys(opts.attr)) el.setAttribute(key, opts.attr[key]);
	}
}

const proto = (globalThis as any).HTMLElement.prototype;
const nodeProto = (globalThis as any).Node.prototype;

nodeProto.createEl = function (tag: string, opts?: DomOpts | string) {
	const el = this.ownerDocument!.createElement(tag);
	applyOpts(el, opts);
	this.appendChild(el);
	return el;
};
nodeProto.createDiv = function (opts?: DomOpts | string) {
	return this.createEl("div", opts);
};
nodeProto.createSpan = function (opts?: DomOpts | string) {
	return this.createEl("span", opts);
};
nodeProto.empty = function () {
	while (this.firstChild) this.removeChild(this.firstChild);
};
nodeProto.setText = function (text: string) {
	this.textContent = text;
};
nodeProto.appendText = function (text: string) {
	this.appendChild(this.ownerDocument!.createTextNode(text));
};
proto.addClass = function (...cls: string[]) {
	this.classList.add(...cls);
};
proto.removeClass = function (...cls: string[]) {
	this.classList.remove(...cls);
};
proto.toggleClass = function (cls: string, on: boolean) {
	this.classList.toggle(cls, on);
};
proto.hasClass = function (cls: string) {
	return this.classList.contains(cls);
};
proto.show = function () {
	this.style.display = "";
};
proto.hide = function () {
	this.style.display = "none";
};
proto.setAttr = function (name: string, value: string) {
	this.setAttribute(name, value);
};

nodeProto.instanceOf = function (type: any) {
	return this instanceof type;
};
(globalThis as any).Event.prototype.instanceOf = function (type: any) {
	return this instanceof type;
};

(globalThis as any).activeWindow = window;
(globalThis as any).activeDocument = document;

// jsdom has no layout; give popover sizing something deterministic.
Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 400 });
Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 150 });

if (!(navigator as any).clipboard) {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: jest.fn(() => Promise.resolve()) },
	});
}

/** ResizeObserver stub: tests trigger callbacks through `ResizeObserver.fire()`. */
class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	static fire(): void {
		for (const o of FakeResizeObserver.instances) o.cb([], o);
	}
	static reset(): void {
		FakeResizeObserver.instances = [];
	}
	constructor(private cb: ResizeObserverCallback) {
		FakeResizeObserver.instances.push(this);
	}
	observe(): void {
		this.cb([], this);
	}
	disconnect(): void {
		FakeResizeObserver.instances = FakeResizeObserver.instances.filter((o) => o !== this);
	}
	unobserve(): void {}
}
(globalThis as any).ResizeObserver = FakeResizeObserver;
