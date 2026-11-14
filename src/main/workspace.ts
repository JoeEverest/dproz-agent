import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceDocument } from "@shared/ipc";
import aboutMeTemplate from "../../resources/templates/about-me.md?raw";
import coverLetterTemplate from "../../resources/templates/cover-letter.html?raw";
import resumeTemplate from "../../resources/templates/resume.html?raw";
import { exists, isInside } from "./files";
import { getSettings } from "./settings";

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
	await writeIfMissing(path.join(paths.templates, "resume.html"), resumeTemplate);
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

async function freeName(directory: string, name: string) {
	const { name: stem, ext } = path.parse(name);
	let candidate = name;
	for (let copy = 2; await exists(path.join(directory, candidate)); copy++) candidate = `${stem} ${copy}${ext}`;
	return candidate;
}

export async function addDocuments(sources: string[]): Promise<WorkspaceDocument[]> {
	const { documents } = await ensureWorkspace();
	for (const source of sources) {
		const stats = await fs.stat(source).catch(() => null);
		if (!stats?.isFile()) continue;
		await fs.copyFile(source, path.join(documents, await freeName(documents, path.basename(source))));
	}
	return listDocuments();
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

export async function writeAboutMe(content: string) {
	const { aboutMe } = await ensureWorkspace();
	await fs.writeFile(aboutMe, content);
}

export async function resolveInWorkspace(file: string) {
	const { root } = await workspacePaths();
	const resolved = path.resolve(root, file);
	if (!isInside(root, resolved)) throw new Error(`${file} is outside the workspace (${root}).`);
	return resolved;
}
