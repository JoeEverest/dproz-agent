import fs from "node:fs/promises";
import path from "node:path";
import type { ProfileSaved, WorkspaceDocument } from "@shared/ipc";
import aboutMeTemplate from "../../resources/templates/about-me.md?raw";
import coverLetterTemplate from "../../resources/templates/cover-letter.html?raw";
import { exists, isInside } from "./files";
import { getSettings, updateSettings } from "./settings";

export type WorkspacePaths = {
	root: string;
	aboutMe: string;
	documents: string;
	applications: string;
	templates: string;
	inbox: string;
};

export function pathsFor(root: string): WorkspacePaths {
	return {
		root,
		aboutMe: path.join(root, "about-me.md"),
		documents: path.join(root, "documents"),
		applications: path.join(root, "applications"),
		templates: path.join(root, "templates"),
		inbox: path.join(root, "inbox.json"),
	};
}

export const workspacePaths = async () => pathsFor((await getSettings()).workspaceDir);

async function writeIfMissing(file: string, content: string) {
	if (!(await exists(file))) await fs.writeFile(file, content);
}

export async function ensureWorkspace(): Promise<WorkspacePaths> {
	const paths = await workspacePaths();
	for (const directory of [paths.documents, paths.applications, paths.templates]) {
		await fs.mkdir(directory, { recursive: true });
	}
	await writeIfMissing(paths.aboutMe, aboutMeTemplate);
	await writeIfMissing(path.join(paths.templates, "cover-letter.html"), coverLetterTemplate);
	return paths;
}

export async function listDocuments(): Promise<WorkspaceDocument[]> {
	const { documents } = await ensureWorkspace();
	const entries = await fs.readdir(documents, { withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile() && !entry.name.startsWith("."));
	const described = await Promise.all(
		files.map(async (entry) => {
			const file = path.join(documents, entry.name);
			const stats = await fs.stat(file);
			return { name: entry.name, path: file, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
		}),
	);
	return described.sort((a, b) => a.name.localeCompare(b.name));
}

export async function freeName(directory: string, name: string) {
	const { name: stem, ext } = path.parse(name);
	let candidate = name;
	for (let copy = 2; await exists(path.join(directory, candidate)); copy++) candidate = `${stem} ${copy}${ext}`;
	return candidate;
}

export async function addDocuments(sources: string[]): Promise<WorkspaceDocument[]> {
	const { root, documents } = await ensureWorkspace();
	let directory: string | undefined;
	for (const source of sources) {
		const stats = await fs.stat(source).catch(() => null);
		if (!stats?.isFile()) continue;
		await fs.copyFile(source, path.join(documents, await freeName(documents, path.basename(source))));
		if (!directory && !isInside(root, path.resolve(source))) directory = path.dirname(path.resolve(source));
	}
	if (directory) await updateSettings({ lastDocumentDirectory: directory });
	return listDocuments();
}

/**
 * Copies the files the user attached to an answer into documents/ and returns the names they were
 * stored under. Unlike addDocuments, a file that cannot be read fails all of it with nothing kept, so
 * an answer never names a document that did not arrive.
 */
export async function importDocuments(sources: string[]): Promise<string[]> {
	if (!sources.length) return [];
	const { root, documents } = await ensureWorkspace();
	const stored: string[] = [];
	try {
		for (const source of sources) {
			const stats = await fs.stat(source).catch(() => null);
			if (!stats?.isFile()) throw new Error(`${path.basename(source)} could not be read.`);
			const name = await freeName(documents, path.basename(source));
			await fs.copyFile(source, path.join(documents, name), fs.constants.COPYFILE_EXCL);
			stored.push(name);
		}
	} catch (error) {
		await forgetDocuments(stored);
		throw error;
	}
	const outside = sources.map((source) => path.resolve(source)).find((source) => !isInside(root, source));
	if (outside) await updateSettings({ lastDocumentDirectory: path.dirname(outside) });
	return stored;
}

/** Takes back documents imported for an answer that was then not saved. */
export async function forgetDocuments(names: string[]) {
	const { documents } = await workspacePaths();
	await Promise.all(names.map((name) => fs.rm(path.join(documents, name), { force: true })));
}

export async function removeDocument(name: string): Promise<WorkspaceDocument[]> {
	const { documents } = await workspacePaths();
	const target = path.join(documents, name);
	if (isInside(documents, target) && target !== documents) await fs.rm(target, { force: true });
	return listDocuments();
}

export async function readAboutMe() {
	const { aboutMe } = await ensureWorkspace();
	return fs.readFile(aboutMe, "utf8");
}

/**
 * Saves the user's edit of their master resume. `base` is the text their edit started from: if the
 * agent has changed the file since, nothing is written and the current text is handed back, so
 * neither side's work is lost without the user choosing.
 */
export async function writeAboutMe(content: string, base?: string): Promise<ProfileSaved> {
	const { aboutMe } = await ensureWorkspace();
	const current = await fs.readFile(aboutMe, "utf8").catch(() => "");
	if (base !== undefined && current.trim() !== base.trim()) return { saved: false, current };
	await fs.writeFile(aboutMe, content);
	return { saved: true, previous: current };
}

export async function resolveInWorkspace(file: string) {
	const { root } = await workspacePaths();
	const resolved = path.resolve(root, file);
	if (!isInside(root, resolved)) throw new Error(`${file} is outside the workspace (${root}).`);
	return resolved;
}
