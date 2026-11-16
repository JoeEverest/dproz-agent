import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ workspaceDir: "", lastDocumentDirectory: undefined as string | undefined }));
vi.mock("../../src/main/settings", () => ({
	getSettings: async () => state,
	updateSettings: async (patch: object) => Object.assign(state, patch),
}));
const { addDocuments, ensureWorkspace } = await import("../../src/main/workspace");
let base: string;
const source = async (folder: string, name = "resume.txt") => {
	const directory = path.join(base, folder);
	await fs.mkdir(directory, { recursive: true });
	const file = path.join(directory, name);
	await fs.writeFile(file, "A synthetic resume");
	return file;
};
beforeEach(async () => {
	base = await fs.mkdtemp(path.join(os.tmpdir(), "dproz-documents-"));
	state.workspaceDir = path.join(base, "workspace");
	state.lastDocumentDirectory = path.join(base, "previous");
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(base, { recursive: true, force: true });
});

describe("the local document source directory", () => {
	it("remembers the source after copying and keeps collision handling", async () => {
		const file = await source("uploads");
		const documents = await addDocuments([file, file]);
		expect(documents.map((document) => document.name)).toEqual(["resume 2.txt", "resume.txt"]);
		expect(state.lastDocumentDirectory).toBe(path.dirname(file));
		expect(await fs.readFile(documents[0].path, "utf8")).toBe("A synthetic resume");
	});
	it("uses the first successfully copied external file in a mixed selection", async () => {
		const first = await source("first");
		const second = await source("second");
		await addDocuments([path.join(base, "missing.txt"), base, first, second]);
		expect(state.lastDocumentDirectory).toBe(path.dirname(first));
	});
	it("retains the preference for an empty or invalid selection", async () => {
		await addDocuments([]);
		await addDocuments([base, path.join(base, "missing.txt")]);
		expect(state.lastDocumentDirectory).toBe(path.join(base, "previous"));
	});
	it("does not remember the application's internal document copies", async () => {
		const { documents } = await ensureWorkspace();
		const internal = path.join(documents, "existing.txt");
		await fs.writeFile(internal, "Already uploaded");
		await addDocuments([internal]);
		expect(state.lastDocumentDirectory).toBe(path.join(base, "previous"));
	});
	it("does not change the preference when copying fails", async () => {
		const file = await source("uploads");
		vi.spyOn(fs, "copyFile").mockRejectedValueOnce(new Error("copy denied"));
		await expect(addDocuments([file])).rejects.toThrow("copy denied");
		expect(state.lastDocumentDirectory).toBe(path.join(base, "previous"));
	});
	it("retains the preference if a later file makes a batch fail", async () => {
		const first = await source("first");
		const second = await source("second");
		const copyFile = fs.copyFile.bind(fs);
		vi.spyOn(fs, "copyFile").mockImplementationOnce(copyFile).mockRejectedValueOnce(new Error("copy denied"));
		await expect(addDocuments([first, second])).rejects.toThrow("copy denied");
		expect(state.lastDocumentDirectory).toBe(path.join(base, "previous"));
		expect(await fs.readFile(path.join(state.workspaceDir, "documents", "resume.txt"), "utf8")).toBe(
			"A synthetic resume",
		);
	});
});
