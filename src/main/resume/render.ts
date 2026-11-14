/**
 * Prints a resume from structured data in one of five layouts, ported from the resume tailoring in
 * Dproz Fit Check. The layouts keep their markup and proportions; what changed for this app is that they
 * print to A4 with page margins, sizes are in points, and nothing is fetched from the network: the one
 * web font they use is embedded.
 */
import { RESUME_SECTIONS, type Resume, type ResumeSection, type ResumeTemplateId } from "@shared/resume";
import {
	escapeHtml,
	fullName,
	inline,
	type Job,
	type Language,
	mdLines,
	mdToHtml,
	type Reference,
	type School,
} from "./html";
import { classic } from "./templates/classic";
import { compact } from "./templates/compact";
import { executive } from "./templates/executive";
import { minimal } from "./templates/minimal";
import { modern } from "./templates/modern";

export type Template = {
	css: string;
	header: (resume: Resume) => string;
	job: (job: Job) => string;
	school: (school: School) => string;
	languages: (languages: Language[]) => string;
	reference: (reference: Reference) => string;
	/** Headings this layout words differently. */
	titles?: Partial<Record<ResumeSection, string>>;
	/** The layout prints the summary under the name, with no heading. */
	summaryInHeader?: boolean;
};

const TEMPLATES: Record<ResumeTemplateId, Template> = { classic, modern, compact, minimal, executive };

const TITLES: Record<ResumeSection, string> = {
	summary: "Summary",
	skills: "Skills",
	experience: "Experience",
	education: "Education",
	certifications: "Certifications",
	custom: "",
	accomplishments: "Accomplishments",
	affiliations: "Affiliations",
	languages: "Languages",
	additional: "Additional Information",
	references: "Referees",
};

// Shared by every layout: resets, where a page may break, and the two blocks the originals had no
// structured form for (skills by group, referees side by side).
const BASE = `
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); }
h1, h2, p, ul { margin: 0; }
h2 { break-after: avoid; }
/* An entry's heading lines stay with what follows them, without gluing one entry to the next. */
.entry > * + * { break-before: avoid; }
li, .ref, .skill { break-inside: avoid; }
.skills { display: grid; grid-template-columns: max-content 1fr; column-gap: 12pt; row-gap: 2.5pt; }
.skills .group { font-weight: 700; }
.skills .all { grid-column: 1 / -1; }
.refs { display: grid; grid-template-columns: 1fr 1fr; gap: 7pt 20pt; }
`;

const block = (title: string, inner: string) =>
	inner.trim() ? `<section><h2>${escapeHtml(title)}</h2>${inner}</section>` : "";

/**
 * The skills section. A labelled line ("Databases: PostgreSQL, Redis") becomes a row with its label in
 * the first column. A plain list of short names is set as one run of text, because a bullet for each of
 * twenty tools wastes a quarter of the page.
 */
function skills(markdown?: string | null) {
	const rows = mdLines(markdown).map((line) => {
		const labelled = line.replace(/\*\*/g, "").match(/^([^:]{1,40}):\s*(.+)$/);
		return labelled ? { group: labelled[1].trim(), items: labelled[2].trim() } : { items: line };
	});
	if (!rows.length) return "";
	if (rows.every((row) => !row.group && row.items.length <= 40)) {
		return `<p>${rows.map((row) => inline(row.items)).join(", ")}</p>`;
	}
	const cells = rows.map((row) =>
		row.group
			? `<span class="group">${escapeHtml(row.group)}</span><span class="skill">${inline(row.items)}</span>`
			: `<span class="skill all">${inline(row.items)}</span>`,
	);
	return `<div class="skills">${cells.join("")}</div>`;
}

export type Layout = { template: ResumeTemplateId; sectionOrder?: ResumeSection[] };

/**
 * `fonts` is @font-face CSS for the typefaces a layout names that are not on every computer. Without
 * it a layout falls back to the system fonts in its stack.
 */
export function renderResume(resume: Resume, layout: Layout, fonts = ""): string {
	const template = TEMPLATES[layout.template];
	const title = (key: ResumeSection) => template.titles?.[key] ?? TITLES[key];
	const languages = resume.languages ?? [];
	const references = resume.references ?? [];

	const sections: Record<ResumeSection, string> = {
		summary: template.summaryInHeader ? "" : block(title("summary"), mdToHtml(resume.summary)),
		skills: block(title("skills"), skills(resume.skills)),
		experience: block(title("experience"), (resume.workExperience ?? []).map(template.job).join("")),
		education: block(title("education"), (resume.education ?? []).map(template.school).join("")),
		certifications: block(title("certifications"), mdToHtml(resume.certifications)),
		custom: (resume.customSections ?? []).map((section) => block(section.title, mdToHtml(section.content))).join(""),
		accomplishments: block(title("accomplishments"), mdToHtml(resume.accomplishments)),
		affiliations: block(title("affiliations"), mdToHtml(resume.affiliations)),
		languages: block(title("languages"), languages.length ? `<div>${template.languages(languages)}</div>` : ""),
		additional: block(title("additional"), mdToHtml(resume.additionalInfo)),
		references: block(
			title("references"),
			references.length ? `<div class="refs">${references.map(template.reference).join("")}</div>` : "",
		),
	};

	const order = [...new Set([...(layout.sectionOrder ?? []), ...RESUME_SECTIONS])];
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(fullName(resume.contact))} – Resume</title>
<style>${fonts}${BASE}${template.css}</style>
</head>
<body>
${template.header(resume)}
${order.map((key) => sections[key]).join("\n")}
</body>
</html>`;
}
