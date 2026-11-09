/**
 * Minimal stand-in for the `obsidian` package so pure modules that transitively
 * import it can be unit-tested outside the app. Only what tests touch is here.
 */
export function requestUrl(): never {
	throw new Error("requestUrl is not available in unit tests");
}
export class Notice {
	constructor(public message: string) {}
}
