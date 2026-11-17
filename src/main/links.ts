/**
 * Links as sources about the user, next to their documents.
 *
 * A link to a file (a resume PDF, a Google Doc shared by link) is downloaded into documents/ and is an
 * ordinary document from then on. A link to a page (a portfolio, a LinkedIn or GitHub profile) is kept in
 * links.json in the workspace, and the agent reads the page itself, with its browser when it needs one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { LinkAdded, SourceLink } from "@shared/ipc";
import { downloadAddress, normaliseLink } from "@shared/links";
import { readJson, writeJson } from "./files";
import { freeName, listDocuments, workspacePaths } from "./workspace";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = {
	"application/pdf": ".pdf",
	"application/msword": ".doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
	"application/vnd.oasis.opendocument.text": ".odt",
	"application/rtf": ".rtf",
	"text/rtf": ".rtf",
	"text/plain": ".txt",
	"text/markdown": ".md",
	"image/png": ".png",
	"image/jpeg": ".jpg",
};

const linksFile = async () => path.join((await workspacePaths()).root, "links.json");

export async function listLinks(): Promise<SourceLink[]> {
	const links = await readJson<SourceLink[]>(await linksFile(), []);
	return Array.isArray(links) ? links.filter((link) => typeof link?.url === "string") : [];
}

/** The name a downloaded file should have: what the server calls it, else the end of the address. */
function fileName(response: Response, extension: string) {
	const disposition = response.headers.get("content-disposition") ?? "";
	const encoded = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
	const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
	const url = new URL(response.url);
	let name = encoded ?? plain ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
	try {
		name = decodeURIComponent(name);
	} catch {}
	name = path.basename(name.replace(/[\\/:*?"<>|]/g, " ").trim());
	if (!name || name.startsWith(".")) name = url.hostname;
	return path.extname(name).toLowerCase() === extension ? name : `${name}${extension}`;
}

/** The file a link points at, or null when it is a page (or cannot be fetched from here). */
async function fetchFile(link: string): Promise<{ name: string; bytes: Uint8Array } | null> {
	try {
		const response = await fetch(downloadAddress(link), { redirect: "follow", signal: AbortSignal.timeout(20_000) });
		const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
		const extension = FILE_TYPES[type];
		if (!response.ok || !extension) return null;
		if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) return null;
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return null;
		return { name: fileName(response, extension), bytes };
	} catch {
		return null;
	}
}

export async function addLink(input: string): Promise<LinkAdded> {
	const url = normaliseLink(input);
	const links = await listLinks();
	if (!url || links.some((link) => link.url === url)) return { documents: await listDocuments(), links };

	const file = await fetchFile(url);
	if (file) {
		const { documents } = await workspacePaths();
		const name = await freeName(documents, file.name);
		await fs.writeFile(path.join(documents, name), file.bytes);
		return { documents: await listDocuments(), links, added: { kind: "document", name } };
	}

	const next = [...links, { url, addedAt: new Date().toISOString() }];
	await writeJson(await linksFile(), next);
	return { documents: await listDocuments(), links: next, added: { kind: "link", url } };
}

/**
 * Keeps the links the user wrote in an answer, as addLink would: a link to a file is downloaded into
 * documents/, a link to a page is added to their links. `undo` takes back only what was new, for an
 * answer that could not be saved.
 */
export async function keepAnswerLinks(urls: string[]) {
	const known = await listLinks();
	const documents: string[] = [];
	const links: string[] = [];
	const added: SourceLink[] = [];
	const { documents: folder } = await workspacePaths();
	const undo = async () => {
		await Promise.all(documents.map((name) => fs.rm(path.join(folder, name), { force: true })));
		if (!added.length) return;
		const fresh = new Set(added.map((link) => link.url));
		await writeJson(
			await linksFile(),
			(await listLinks()).filter((link) => !fresh.has(link.url)),
		);
	};
	try {
		for (const url of urls) {
			const file = known.some((link) => link.url === url) ? null : await fetchFile(url);
			if (file) {
				await fs.mkdir(folder, { recursive: true });
				const name = await freeName(folder, file.name);
				await fs.writeFile(path.join(folder, name), file.bytes, { flag: "wx" });
				documents.push(name);
				continue;
			}
			links.push(url);
			if (!known.some((link) => link.url === url)) added.push({ url, addedAt: new Date().toISOString() });
		}
		if (added.length) await writeJson(await linksFile(), [...(await listLinks()), ...added]);
	} catch (error) {
		await undo();
		throw error;
	}
	return { documents, links, undo };
}

export async function removeLink(url: string): Promise<SourceLink[]> {
	const next = (await listLinks()).filter((link) => link.url !== url);
	await writeJson(await linksFile(), next);
	return next;
}
