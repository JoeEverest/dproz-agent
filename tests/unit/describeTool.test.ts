import { describe, expect, it } from "vitest";
import { describeTool } from "../../src/main/agent/describeTool";

describe("describeTool", () => {
	it("names browser actions by what the user would see", () => {
		expect(describeTool("mcp__browser__browser_navigate", { url: "https://www.careers.example.com/apply?id=1" })).toBe(
			"Open careers.example.com",
		);
		expect(describeTool("mcp__browser__browser_file_upload", { paths: ["/w/applications/x/Resume.pdf"] })).toBe(
			"Upload Resume.pdf",
		);
	});

	it("never includes a password or typed text", () => {
		const saved = describeTool("mcp__desk__save_credentials", {
			site: "careers.example.com",
			username: "a@b.c",
			password: "hunter2",
		});
		const typed = describeTool("mcp__browser__browser_type", { element: "Password field", text: "hunter2" });
		expect(saved).toBe("Save the login for careers.example.com");
		expect(`${saved}${typed}`).not.toContain("hunter2");
	});

	it("falls back to a readable name for tools it does not know", () => {
		expect(describeTool("mcp__browser__browser_network_requests", {})).toBe("browser network requests");
	});
});
