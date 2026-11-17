/**
 * Runtime narrowing for tests. Each helper checks the value and throws a clear
 * Error when it is not what the test expects, so tests need no `!`, `as` or `any`.
 */

/** A class constructor, including abstract ones such as obsidian's `Editor`. */
export type ClassOf<T> = abstract new (...args: never[]) => T;

/** Returns `value` when it is neither null nor undefined; throws otherwise. */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
	if (value === null || value === undefined) {
		throw new Error(`Expected ${what} to be defined, got ${String(value)}`);
	}
	return value;
}

/** Returns `value` as an instance of `type`, e.g. a DOM element from a query. */
export function instanceOf<T>(value: unknown, type: ClassOf<T>, what = 'value'): T {
	if (value instanceof type) return value;
	throw new Error(`Expected ${what} to be a ${type.name}`);
}

/**
 * Narrows a value typed by the real `obsidian` declarations to the test double
 * behind it, keeping both types: `asStub(plugin, Plugin)` is
 * `TranslatePolishPlugin & StubPlugin`, so stub-only members such as
 * `commands`, `settingTab` and `savedData()` become visible. Pass the class
 * imported from `tests/helpers/obsidian-stub`.
 */
export function asStub<T, S>(value: T, stubClass: ClassOf<S>): T & S {
	if (value instanceof stubClass) return value;
	throw new Error(`Expected a ${stubClass.name} test double`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Returns `value` as a plain record of unknown fields; throws for non-objects. */
export function record(value: unknown, what = 'value'): Record<string, unknown> {
	if (isRecord(value)) return value;
	throw new Error(`Expected ${what} to be an object, got ${String(value)}`);
}

/** Parses a JSON request body (string) into a record of unknown fields. */
export function jsonRecord(text: unknown, what = 'JSON body'): Record<string, unknown> {
	if (typeof text !== 'string') throw new Error(`Expected ${what} to be a string`);
	const data: unknown = JSON.parse(text);
	return record(data, what);
}
