import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openExternal: vi.fn(), broadcast: vi.fn() }));
vi.mock("electron", () => ({
	app: { getVersion: () => "0.4.2", isPackaged: false },
	shell: { openExternal: mocks.openExternal },
}));
vi.mock("../../src/main/events", () => ({ broadcast: mocks.broadcast }));

let updates: typeof import("../../src/main/updates");
const fetchMock = vi.fn<typeof fetch>();
const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "deb";
const url = (version: string) => `https://example.com/${version}/${platform}`;
const release = (version: string) => ({ version, downloads: { [platform]: url(version) } });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	vi.stubEnv("DPROZ_AGENT_UPDATE_URL", "https://example.com/api/latest");
	vi.stubEnv("APPIMAGE", "");
	mocks.openExternal.mockResolvedValue(undefined);
	updates = await import("../../src/main/updates");
	fetchMock.mockResolvedValue(respond(release("0.4.3")));
	await updates.checkForUpdate();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("opening the latest installer", () => {
	it("refreshes a stale offer, updates its version and opens only the fresh platform URL", async () => {
		fetchMock.mockResolvedValue(respond(release("0.5.0")));
		const result = await updates.openUpdateDownload();
		expect(result).toMatchObject({ latest: "0.5.0", url: url("0.5.0"), openingDownload: false });
		expect(fetchMock).toHaveBeenLastCalledWith(
			"https://example.com/api/latest",
			expect.objectContaining({ cache: "no-store" }),
		);
		expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url("0.5.0"));
	});

	it("shares the busy guard across simultaneous download actions", async () => {
		let finish!: (response: Response) => void;
		fetchMock.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const first = updates.openUpdateDownload();
		expect(updates.updateStatus().openingDownload).toBe(true);
		await updates.openUpdateDownload();
		finish(respond(release("0.5.0")));
		await first;
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mocks.openExternal).toHaveBeenCalledTimes(1);
	});

	it("finishes an overlapping poll before making a fresh request", async () => {
		let finishPoll!: (response: Response) => void;
		fetchMock.mockReturnValueOnce(
			new Promise((resolve) => {
				finishPoll = resolve;
			}),
		);
		const poll = updates.checkForUpdate();
		expect(updates.checkForUpdate()).toBe(poll);
		const opening = updates.openUpdateDownload();
		fetchMock.mockResolvedValue(respond(release("0.5.0")));
		finishPoll(respond(release("0.4.3")));
		await opening;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url("0.5.0"));
		expect(updates.updateStatus().latest).toBe("0.5.0");
	});

	it.each(["HTTP failure", "network failure", "malformed JSON", "missing version"])(
		"does not open a stale URL after %s",
		async (failure) => {
			if (failure === "HTTP failure") fetchMock.mockResolvedValue(respond({}, 503));
			if (failure === "network failure") fetchMock.mockRejectedValue(new Error("Offline"));
			if (failure === "malformed JSON") fetchMock.mockResolvedValue(new Response("not JSON"));
			if (failure === "missing version") fetchMock.mockResolvedValue(respond({}));
			const result = await updates.openUpdateDownload();
			expect(result.error).toBeTruthy();
			expect(result.latest).toBe("0.4.3");
			expect(result.openingDownload).toBe(false);
			expect(mocks.openExternal).not.toHaveBeenCalled();
			fetchMock.mockResolvedValue(respond(release("0.5.0")));
			expect((await updates.openUpdateDownload()).error).toBeUndefined();
			expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url("0.5.0"));
		},
	);

	it("does not substitute the release page or an old installer when the platform asset is missing", async () => {
		fetchMock.mockResolvedValue(respond({ version: "0.5.0", page: "https://example.com/releases" }));
		const result = await updates.openUpdateDownload();
		expect(result.error).toContain("no installer for this platform");
		expect(result.url).toBeUndefined();
		expect(result.latest).toBe("0.5.0");
		expect(mocks.openExternal).not.toHaveBeenCalled();
	});

	it.each(["file:///tmp/installer", "javascript:alert(1)", "mailto:test@example.com", "not a URL"])(
		"does not pass an invalid installer URL to the shell: %s",
		async (invalid) => {
			fetchMock.mockResolvedValue(respond({ version: "0.5.0", downloads: { [platform]: invalid } }));
			expect((await updates.openUpdateDownload()).error).toBeTruthy();
			expect(mocks.openExternal).not.toHaveBeenCalled();
		},
	);

	it("opens the current offer if unchanged, but nothing when no newer release remains", async () => {
		fetchMock.mockResolvedValue(respond(release("0.4.3")));
		await updates.openUpdateDownload();
		expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url("0.4.3"));
		mocks.openExternal.mockClear();
		fetchMock.mockResolvedValue(respond(release("0.4.2")));
		expect((await updates.openUpdateDownload()).available).toBe(false);
		expect(mocks.openExternal).not.toHaveBeenCalled();
	});

	it("reports browser-opening failure and allows retry", async () => {
		fetchMock.mockImplementation(async () => respond(release("0.5.0")));
		mocks.openExternal.mockRejectedValueOnce(new Error("No browser available"));
		expect((await updates.openUpdateDownload()).error).toBe("No browser available");
		expect((await updates.openUpdateDownload()).error).toBeUndefined();
		expect(mocks.openExternal).toHaveBeenCalledTimes(2);
	});

	it("does not request or open anything when update checks are disabled", async () => {
		vi.resetModules();
		vi.stubEnv("DPROZ_AGENT_UPDATE_URL", "");
		const disabled = await import("../../src/main/updates");
		fetchMock.mockClear();
		expect((await disabled.openUpdateDownload()).error).toBe("Update checks are disabled.");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mocks.openExternal).not.toHaveBeenCalled();
	});
});
