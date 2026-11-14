import type { Resume } from "@shared/resume";

export type Job = NonNullable<Resume["workExperience"]>[number];
export type School = NonNullable<Resume["education"]>[number];
export type Language = NonNullable<Resume["languages"]>[number];
export type Reference = NonNullable<Resume["references"]>[number];
type Place = Job["location"];

export const escapeHtml = (text: unknown) =>
	String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** Text with **bold** and _italic_ allowed, and nothing else. */
export const inline = (text: unknown) =>
	escapeHtml(text)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|\s)_(.+?)_(?=\s|[.,;:]|$)/g, "$1<em>$2</em>");

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

/** A Markdown section as its lines: bullets and plain lines alike, without their markers. */
export const mdLines = (markdown?: string | null) =>
	(markdown ?? "")
		.split("\n")
		.map((row) => (row.match(BULLET)?.[1] ?? row).trim())
		.filter(Boolean);

/** Only the bullets of a Markdown section. */
export const mdBullets = (markdown?: string | null) =>
	(markdown ?? "")
		.split("\n")
		.map((row) => row.match(BULLET)?.[1].trim() ?? "")
		.filter(Boolean);

/** Markdown as the layouts print it: "- " lines become a list, anything else a paragraph. */
export function mdToHtml(markdown?: string | null) {
	let html = "";
	let inList = false;
	for (const row of (markdown ?? "").split("\n")) {
		const bullet = row.match(BULLET);
		if (bullet) {
			html += `${inList ? "" : "<ul>"}<li>${inline(bullet[1].trim())}</li>`;
			inList = true;
			continue;
		}
		if (inList) html += "</ul>";
		inList = false;
		if (row.trim()) html += `<p>${inline(row.trim())}</p>`;
	}
	return inList ? `${html}</ul>` : html;
}

export const placeText = (place: Place) => [place?.city, place?.region, place?.country].filter(Boolean).join(", ");

export function dateRange(job: Pick<Job, "startDate" | "endDate" | "current">) {
	const end = job.current ? "Present" : (job.endDate ?? "");
	return [job.startDate, end].filter(Boolean).join(" – ");
}

export const fullName = (contact: Resume["contact"]) =>
	[contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(" ");

/** "BSc." and "Computer Science" read as one line, without repeating a field the level already names. */
export function degree(school: School) {
	const level = (school.educationLevel ?? "").trim();
	const field = (school.fieldOfStudy ?? "").trim();
	if (level && field && !level.toLowerCase().includes(field.toLowerCase())) return `${level}, ${field}`;
	return level || field;
}

export const links = (resume: Resume) =>
	(resume.personalLinks ?? [])
		.map((link) => link.value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""))
		.filter(Boolean)
		.slice(0, 3);

/** Place, phone, email and links, in the order a reader looks for them. */
export const contactBits = (resume: Resume) =>
	[placeText(resume.contact.location), resume.contact.phone, resume.contact.email, ...links(resume)]
		.filter(Boolean)
		.map(escapeHtml);

export const languageText = (language: Language, joiner: (proficiency: string) => string) =>
	`${escapeHtml(language.language)}${language.proficiency ? joiner(escapeHtml(language.proficiency)) : ""}`;

/** The skills a role used, as one line under it. */
export function roleSkills(job: Job, label: string) {
	const items = mdLines(job.relevantSkills);
	return items.length
		? `<div class="rel"><span class="label">${label}:</span> ${items.map(inline).join(", ")}</div>`
		: "";
}
