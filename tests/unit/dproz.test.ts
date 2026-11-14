import { describe, expect, it } from "vitest";
import { parseHowToApply, stripHtml } from "../../src/main/dproz";

describe("parseHowToApply", () => {
	it("treats a posting with a link as a website application", () => {
		const parsed = parseHowToApply(
			"<p>Prepare an updated CV.</p><p>Apply online through the portal: https://careers.example.com/job/6788.</p>",
		);
		expect(parsed.method).toBe("url");
		expect(parsed.urls).toEqual(["https://careers.example.com/job/6788"]);
	});

	it("treats a posting with only an address as an email application", () => {
		const parsed = parseHowToApply("<p>Email your CV to: <strong>contact@jazia.co</strong></p>");
		expect(parsed.method).toBe("email");
		expect(parsed.emails).toEqual(["contact@jazia.co"]);
		expect(parsed.text).toBe("Email your CV to: contact@jazia.co");
	});

	it("prefers the link when a posting has both and still reports the address", () => {
		const parsed = parseHowToApply("Apply at https://jobs.example.org/apply or write to hr@example.org");
		expect(parsed.method).toBe("url");
		expect(parsed.emails).toEqual(["hr@example.org"]);
	});

	it("does not mistake a link with an @ in it for an email address", () => {
		expect(parseHowToApply("See https://example.com/@team/jobs").emails).toEqual([]);
	});

	it("reports unknown when the posting says nothing usable", () => {
		expect(parseHowToApply(undefined).method).toBe("unknown");
		expect(parseHowToApply("<p>Walk in with your documents.</p>").method).toBe("unknown");
	});
});

describe("stripHtml", () => {
	it("keeps paragraph breaks and decodes entities", () => {
		expect(stripHtml("<p>Tom &amp; Jerry</p><p>Line&nbsp;two</p>")).toBe("Tom & Jerry\nLine two");
	});
});
