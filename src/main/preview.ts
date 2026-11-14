import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { applicationFolder } from "./applications";
import { isInside } from "./files";
import { workspacePaths } from "./workspace";

// Serves the user's own documents to the interface so they can be previewed in the window:
//   desk-doc://application/<id>/<file>   a document attached to a job card
//   desk-doc://documents/<name>          one of the documents the user handed over
// Nothing outside those two folders can be read through it.
export const PREVIEW_SCHEME = "desk-doc";

export function registerPreviewScheme() {
	protocol.registerSchemesAsPrivileged([
		{ scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
	]);
}

async function resolve(url: URL) {
	const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
	if (url.hostname === "application" && parts.length >= 2) {
		const folder = await applicationFolder(parts[0]);
		const { applications } = await workspacePaths();
		const target = path.resolve(folder, ...parts.slice(1));
		return isInside(applications, folder) && isInside(folder, target) ? target : null;
	}
	if (url.hostname === "documents" && parts.length >= 1) {
		const { documents } = await workspacePaths();
		const target = path.resolve(documents, ...parts);
		return isInside(documents, target) ? target : null;
	}
	return null;
}

export function servePreviews() {
	protocol.handle(PREVIEW_SCHEME, async (request) => {
		const target = await resolve(new URL(request.url)).catch(() => null);
		if (!target) return new Response("Not found", { status: 404 });
		try {
			return await net.fetch(pathToFileURL(target).toString());
		} catch {
			return new Response("Not found", { status: 404 });
		}
	});
}
