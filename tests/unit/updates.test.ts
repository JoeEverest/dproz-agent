import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The way of standing in for Electron here comes from Paul John's pull request #4.
vi.mock("electron", () => ({ app: { getVersion: () => "0.5.0", isPackaged: false } }));
vi.mock("../../src/main/events", () => ({ broadcast: () => {} }));

let updates: typeof import("../../src/main/updates");
const site = vi.fn<typeof fetch>();
const key = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "deb";
const release = (version: string) =>
	new Response(JSON.stringify({ version, downloads: { [key]: `https://example.com/${version}` } }));

beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.stubGlobal("fetch", site);
	vi.stubEnv("DPROZ_AGENT_UPDATE_URL", "https://example.com/api/latest");
	vi.stubEnv("APPIMAGE", "");
	site.mockReset();
	updates = await import("../../src/main/updates");
	site.mockImplementation(async () => release("0.5.1"));
	await updates.checkForUpdate();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("checking for a newer release", () => {
	it("replaces an earlier offer with the release that is out now", async () => {
		site.mockImplementation(async () => release("0.5.2"));
		expect(await updates.checkForUpdate()).toMatchObject({ latest: "0.5.2", url: "https://example.com/0.5.2" });
	});

	it("reuses an answer that is recent enough, and asks again once it is not", async () => {
		site.mockImplementation(async () => release("0.5.2"));
		vi.advanceTimersByTime(30_000);
		expect((await updates.checkForUpdate(60_000)).latest).toBe("0.5.1");
		expect(site).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(31_000);
		expect((await updates.checkForUpdate(60_000)).latest).toBe("0.5.2");
		expect(site).toHaveBeenCalledTimes(2);
	});

	it("shares one request between askers that overlap", async () => {
		const [first, second] = await Promise.all([updates.checkForUpdate(), updates.checkForUpdate()]);
		expect(first).toBe(second);
		expect(site).toHaveBeenCalledTimes(2);
	});

	it("keeps the earlier offer when the site cannot be reached", async () => {
		site.mockRejectedValue(new Error("offline"));
		expect(await updates.checkForUpdate()).toMatchObject({
			latest: "0.5.1",
			available: true,
			url: "https://example.com/0.5.1",
			error: "offline",
		});
	});
});
