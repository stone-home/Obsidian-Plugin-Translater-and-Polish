import { isSoftErrorMessage } from "../translation-job";

describe("isSoftErrorMessage", () => {
	it("retries on timeouts, connection failures and 5xx", () => {
		for (const m of [
			"Request timeout after 20000 ms",
			"net::ERR_CONNECTION_REFUSED",
			"getaddrinfo ENOTFOUND host ERR_NAME_NOT_RESOLVED",
			"HTTP 503: upstream",
			"fetch failed",
		]) {
			expect(isSoftErrorMessage(m)).toBe(true);
		}
	});
	it("does not retry on client errors", () => {
		expect(isSoftErrorMessage("HTTP 401: unauthorized")).toBe(false);
		expect(isSoftErrorMessage("No content in translation response.")).toBe(false);
	});
});
