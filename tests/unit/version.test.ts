import { describe, expect, it } from "vitest";
import { isNewer } from "../../src/shared/version";

describe("isNewer", () => {
	it("compares dotted versions number by number", () => {
		expect(isNewer("0.2.0", "0.1.9")).toBe(true);
		expect(isNewer("0.10.0", "0.9.0")).toBe(true);
		expect(isNewer("1.0.0", "0.99.99")).toBe(true);
	});

	it("is false for the same or an older version", () => {
		expect(isNewer("0.1.0", "0.1.0")).toBe(false);
		expect(isNewer("0.1.0", "0.2.0")).toBe(false);
	});

	it("accepts a leading v and missing parts", () => {
		expect(isNewer("v0.2", "0.1.5")).toBe(true);
		expect(isNewer("v1", "1.0.0")).toBe(false);
	});
});
