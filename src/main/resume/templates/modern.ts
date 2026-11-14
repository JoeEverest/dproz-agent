import {
	contactBits,
	dateRange,
	degree,
	escapeHtml,
	fullName,
	languageText,
	mdToHtml,
	placeText,
	roleSkills,
} from "../html";
import type { Template } from "../render";

const css = `
@page { size: A4; margin: 15mm 18mm; }
:root { --ink: #1a1a1a; --muted: #555; --faint: #6b6b6b; --rule: #cfcfcf; }
body { font-family: "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif; font-size: 10pt; line-height: 1.4; }
header { margin-bottom: 4pt; }
h1 { font-size: 22pt; font-weight: 700; line-height: 1.15; }
.title { font-size: 11.6pt; color: var(--muted); margin: 2.5pt 0 5.5pt; font-weight: 500; }
.contact { font-size: 9.2pt; color: var(--muted); line-height: 1.6; }
section { margin-top: 12.5pt; }
h2 { font-size: 10pt; text-transform: uppercase; font-weight: 700;
	margin-bottom: 6pt; padding-bottom: 3.5pt; border-bottom: 0.75pt solid var(--rule); }
p { margin-bottom: 4.5pt; }
ul { margin: 3pt 0 0; padding-left: 13pt; }
li { margin: 1.6pt 0; }
.entry { margin-bottom: 8.5pt; }
.entry:last-child { margin-bottom: 0; }
.row { display: flex; justify-content: space-between; gap: 10pt; align-items: baseline; }
.role { font-weight: 700; font-size: 10.4pt; }
.org { color: var(--muted); font-weight: 500; font-size: 9.6pt; margin-top: 0.75pt; }
.meta { color: var(--faint); font-size: 9pt; white-space: nowrap; }
.entry > p { color: var(--muted); font-size: 9.2pt; margin: 2pt 0 0; }
.rel { font-size: 9pt; color: var(--muted); margin: 2.5pt 0 0; }
.rel .label { font-weight: 700; color: var(--ink); }
.chips { display: flex; flex-wrap: wrap; gap: 4pt 14pt; }
.ref { line-height: 1.4; }
.ref .name { font-weight: 700; }
.ref .sub { color: var(--muted); font-size: 9.2pt; }
`;

export const modern: Template = {
	css,
	header: (resume) => `<header>
		<h1>${escapeHtml(fullName(resume.contact))}</h1>
		${resume.contact.title ? `<div class="title">${escapeHtml(resume.contact.title)}</div>` : ""}
		<div class="contact">${contactBits(resume).join("&ensp;|&ensp;")}</div>
	</header>`,
	job: (job) => `<div class="entry">
		<div class="row"><span class="role">${escapeHtml(job.jobTitle)}</span><span class="meta">${escapeHtml(dateRange(job))}</span></div>
		<div class="row"><span class="org">${escapeHtml(job.employer)}</span><span class="meta">${escapeHtml(placeText(job.location))}</span></div>
		${mdToHtml(job.highlights)}${roleSkills(job, "Skills")}
	</div>`,
	school: (school) => `<div class="entry">
		<div class="row"><span class="role">${escapeHtml(degree(school) || school.schoolName)}</span><span class="meta">${escapeHtml(school.graduation)}</span></div>
		<div class="row"><span class="org">${degree(school) ? escapeHtml(school.schoolName) : ""}</span><span class="meta">${escapeHtml(placeText(school.location))}</span></div>
		${mdToHtml(school.details)}
	</div>`,
	languages: (list) =>
		`<div class="chips">${list.map((language) => `<span>${languageText(language, (level) => ` (${level})`)}</span>`).join("")}</div>`,
	reference: (reference) => `<div class="ref">
		<span class="name">${escapeHtml(reference.name)}</span>${reference.designation ? `, ${escapeHtml(reference.designation)}` : ""}
		${reference.workPlace ? `<div>${escapeHtml(reference.workPlace)}</div>` : ""}
		<div class="sub">${[reference.phone, reference.email].filter(Boolean).map(escapeHtml).join(" · ")}</div>
	</div>`,
};
