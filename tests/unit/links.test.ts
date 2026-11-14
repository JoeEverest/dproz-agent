import { describe, expect, it } from "vitest";
import { downloadAddress, linkParts, normaliseLink } from "../../src/shared/links";

describe("normaliseLink", () => {
	it("accepts a web address with or without https://", () => {
		expect(normaliseLink("https://example.com/cv.pdf")).toBe("https://example.com/cv.pdf");
		expect(normaliseLink("  linkedin.com/in/rehema ")).toBe("https://linkedin.com/in/rehema");
		expect(normaliseLink("http://127.0.0.1:4000/me")).toBe("http://127.0.0.1:4000/me");
	});

	it("drops the fragment, so the same page is one link", () => {
		expect(normaliseLink("https://example.com/me#work")).toBe("https://example.com/me");
	});

	it("refuses anything that is not a web link", () => {
		for (const input of [
			"",
			"my resume",
			"resume",
			"mailto:me@example.com",
			"file:///etc/passwd",
			"javascript:alert(1)",
		]) {
			expect(normaliseLink(input)).toBeNull();
		}
	});
});

describe("downloadAddress", () => {
	it("turns Google Docs and Drive share links into their download address", () => {
		expect(downloadAddress("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing")).toBe(
			"https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=pdf",
		);
		expect(downloadAddress("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")).toBe(
			"https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp",
		);
		expect(downloadAddress("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe(
			"https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp",
		);
	});

	it("leaves every other link alone", () => {
		expect(downloadAddress("https://example.com/file/d/1AbCdEfGhIjKlMnOp/cv.pdf")).toBe(
			"https://example.com/file/d/1AbCdEfGhIjKlMnOp/cv.pdf",
		);
		expect(downloadAddress("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit")).toBe(
			"https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit",
		);
	});
});

describe("linkParts", () => {
	it("splits a link into the site and the page", () => {
		expect(linkParts("https://www.linkedin.com/in/rehema/")).toEqual({ site: "linkedin.com", page: "/in/rehema" });
		expect(linkParts("https://example.com/")).toEqual({ site: "example.com", page: "" });
	});
});
