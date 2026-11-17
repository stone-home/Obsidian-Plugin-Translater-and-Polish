/**
 * Replicates the DOM helpers Obsidian adds to Node/HTMLElement prototypes so
 * UI modules run under jsdom. Only the helpers used by src/ are implemented,
 * typed against the global declarations in obsidian.d.ts; where src/ uses a
 * narrower form (a single class name, string attribute values) only that form
 * is supported.
 *
 * Jest runs this file before each test file in the same module registry, so the
 * exports below are the very doubles installed on the globals.
 */

type DomOpts = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	type?: string;
	value?: string;
};

function applyOpts(el: HTMLElement, opts?: DomOpts | string): void {
	if (!opts) return;
	if (typeof opts === 'string') {
		el.className = opts;
		return;
	}
	if (opts.cls) el.className = opts.cls;
	if (opts.text !== undefined) el.textContent = opts.text;
	// Plain property sets on whatever element was created (src/ uses them on inputs).
	if (opts.type) Reflect.set(el, 'type', opts.type);
	if (opts.value !== undefined) Reflect.set(el, 'value', opts.value);
	if (opts.attr) {
		for (const key of Object.keys(opts.attr)) el.setAttribute(key, opts.attr[key]);
	}
}

function ownerDocumentOf(node: Node): Document {
	const doc = node.ownerDocument;
	if (!doc) throw new Error('createEl needs a node that belongs to a document');
	return doc;
}

type NodeHelpers = Pick<
	Node,
	'createEl' | 'createDiv' | 'createSpan' | 'empty' | 'appendText' | 'instanceOf'
> & {
	/** Obsidian declares setText on Element; the double has always put it on Node. */
	setText(this: Node, text: string): void;
};

const nodeHelpers: NodeHelpers = {
	createEl<K extends keyof HTMLElementTagNameMap>(
		this: Node,
		tag: K,
		opts?: DomOpts | string
	): HTMLElementTagNameMap[K] {
		const el = ownerDocumentOf(this).createElement(tag);
		applyOpts(el, opts);
		this.appendChild(el);
		return el;
	},
	createDiv(this: Node, opts?: DomOpts | string): HTMLDivElement {
		return this.createEl('div', opts);
	},
	createSpan(this: Node, opts?: DomOpts | string): HTMLSpanElement {
		return this.createEl('span', opts);
	},
	empty(this: Node): void {
		while (this.firstChild) this.removeChild(this.firstChild);
	},
	setText(this: Node, text: string): void {
		this.textContent = text;
	},
	appendText(this: Node, text: string): void {
		this.appendChild(ownerDocumentOf(this).createTextNode(text));
	},
	instanceOf<T>(this: Node, type: new (...data: never[]) => T): this is T {
		return this instanceof type;
	},
};
Object.assign(Node.prototype, nodeHelpers);

const elementHelpers: Pick<
	HTMLElement,
	| 'addClass'
	| 'removeClass'
	| 'toggleClass'
	| 'hasClass'
	| 'show'
	| 'hide'
	| 'setAttr'
> = {
	addClass(this: HTMLElement, ...cls: string[]): void {
		this.classList.add(...cls);
	},
	removeClass(this: HTMLElement, ...cls: string[]): void {
		this.classList.remove(...cls);
	},
	toggleClass(this: HTMLElement, cls: string, on: boolean): void {
		this.classList.toggle(cls, on);
	},
	hasClass(this: HTMLElement, cls: string): boolean {
		return this.classList.contains(cls);
	},
	show(this: HTMLElement): void {
		this.style.display = '';
	},
	hide(this: HTMLElement): void {
		this.style.display = 'none';
	},
	setAttr(this: HTMLElement, name: string, value: string): void {
		this.setAttribute(name, value);
	},
};
Object.assign(HTMLElement.prototype, elementHelpers);

const eventHelpers: Pick<UIEvent, 'instanceOf'> = {
	instanceOf<T>(this: Event, type: new (...data: never[]) => T): this is T {
		return this instanceof type;
	},
};
Object.assign(Event.prototype, eventHelpers);

Object.assign(globalThis, { activeWindow: window, activeDocument: document });

// jsdom has no layout; give popover sizing something deterministic.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
	configurable: true,
	get: () => 400,
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
	configurable: true,
	get: () => 150,
});

/** The `navigator.clipboard.writeText` double (jsdom has no clipboard). */
export const clipboardWriteText = jest.fn<Promise<void>, [data: string]>(() =>
	Promise.resolve()
);
if (!navigator.clipboard) {
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: clipboardWriteText },
	});
}

/** ResizeObserver stub: tests trigger callbacks through `ResizeObserver.fire()`. */
export class FakeResizeObserver {
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
		FakeResizeObserver.instances = FakeResizeObserver.instances.filter(
			(o) => o !== this
		);
	}
	unobserve(): void {}
}

/** Installs `value` as the global ResizeObserver; `undefined` simulates its absence. */
export function setResizeObserver(value: typeof ResizeObserver | undefined): void {
	Object.assign(globalThis, { ResizeObserver: value });
}

setResizeObserver(FakeResizeObserver);
