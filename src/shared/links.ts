/** A link the user typed, as a full web address, or null when it is not one. "linkedin.com/in/me" counts. */
export function normaliseLink(input: string): string | null {
	const typed = input.trim();
	if (!typed || /\s/.test(typed)) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (!url.hostname.includes(".") && url.hostname !== "localhost" && !/^[\d.]+$/.test(url.hostname)) return null;
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Where the file behind a link can be fetched. A Google Docs or Drive share link opens a viewer page;
 * the same file has a plain download address, which works when it is shared with anyone who has the link.
 */
export function downloadAddress(link: string): string {
	const url = new URL(link);
	const id = url.pathname.match(/\/d\/([\w-]{10,})/)?.[1] ?? url.searchParams.get("id");
	if (url.hostname === "docs.google.com" && id) {
		const kind = url.pathname.split("/")[1];
		if (kind === "document") return `https://docs.google.com/document/d/${id}/export?format=pdf`;
		if (kind === "presentation") return `https://docs.google.com/presentation/d/${id}/export/pdf`;
	}
	if (url.hostname === "drive.google.com" && id) return `https://drive.google.com/uc?export=download&id=${id}`;
	return link;
}

/** A link as it reads in a list: the site, then the page. */
export function linkParts(link: string): { site: string; page: string } {
	try {
		const url = new URL(link);
		const page = decodeURI(url.pathname).replace(/\/$/, "") + url.search;
		return { site: url.host.replace(/^www\./, ""), page };
	} catch {
		return { site: link, page: "" };
	}
}

/**
 * The web links written out in an answer, with their https:// or http://, so a passing mention of a
 * site name is not taken for one. Punctuation that ends the sentence is not part of the link.
 */
export function answerLinks(text: string): string[] {
	const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
	const links = found.map((link) => normaliseLink(link.replace(/[.,;:!?)\]}]+$/, "")));
	return [...new Set(links.filter((link): link is string => link !== null))];
}

/**
 * The job links in what the user pasted into Add a job, when links are all it is: one per line, or
 * separated by spaces or commas. A pasted posting is text, even if it has a link in it, so it gives none.
 */
export function jobLinks(pasted: string): string[] {
	const parts = pasted.split(/[\s,]+/).filter(Boolean);
	const links = parts.map(normaliseLink);
	return links.every((link): link is string => link !== null) ? [...new Set(links)] : [];
}
