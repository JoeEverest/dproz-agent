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
@page { size: A4; margin: 16mm 18mm; }
:root { --ink: #111; --muted: #444; --rule: #000; }
body { font-family: Georgia, "Times New Roman", Times, serif; font-size: 10pt; line-height: 1.4; }
header { text-align: center; }
h1 { font-size: 22pt; line-height: 1.15; }
.title { font-style: italic; color: var(--muted); margin: 2.5pt 0 6pt; font-size: 12.5pt; }
.contact { font-size: 9.6pt; color: var(--muted); line-height: 1.5; }
section { margin-top: 13pt; }
h2 { font-size: 10.5pt; text-transform: uppercase; font-weight: bold;
	border-bottom: 0.75pt solid var(--rule); padding-bottom: 2.5pt; margin-bottom: 6.5pt; }
p { margin-bottom: 4.5pt; }
ul { margin: 3pt 0 0; padding-left: 14pt; }
li { margin: 1.6pt 0; }
.entry { margin-bottom: 9pt; }
.entry:last-child { margin-bottom: 0; }
.row { display: flex; justify-content: space-between; gap: 10pt; align-items: baseline; }
.role { font-weight: bold; font-size: 10.8pt; }
.org { font-style: italic; }
.meta { color: var(--muted); font-size: 9.4pt; white-space: nowrap; }
.entry > p { color: var(--muted); font-size: 9.4pt; margin: 1.5pt 0 0; }
.rel { font-size: 9.4pt; color: var(--muted); margin: 2pt 0 0; }
.ref .name { font-weight: bold; }
.ref .sub { color: var(--muted); font-size: 9.4pt; }
`;

export const classic: Template = {
	css,
	header: (resume) => `<header>
		<h1>${escapeHtml(fullName(resume.contact))}</h1>
		${resume.contact.title ? `<div class="title">${escapeHtml(resume.contact.title)}</div>` : ""}
		<div class="contact">${contactBits(resume).join("&ensp;•&ensp;")}</div>
	</header>`,
	job: (job) => `<div class="entry">
		<div class="row"><span class="role">${escapeHtml(job.jobTitle)}</span><span class="meta">${escapeHtml(dateRange(job))}</span></div>
		<div class="row"><span class="org">${escapeHtml(job.employer)}</span><span class="meta">${escapeHtml(placeText(job.location))}</span></div>
		${mdToHtml(job.highlights)}${roleSkills(job, "Relevant skills")}
	</div>`,
	school: (school) => `<div class="entry">
		<div class="row"><span class="role">${escapeHtml(degree(school) || school.schoolName)}</span><span class="meta">${escapeHtml(school.graduation)}</span></div>
		<div class="row"><span class="org">${degree(school) ? escapeHtml(school.schoolName) : ""}</span><span class="meta">${escapeHtml(placeText(school.location))}</span></div>
		${mdToHtml(school.details)}
	</div>`,
	languages: (list) => list.map((language) => languageText(language, (level) => ` (${level})`)).join("&ensp;•&ensp;"),
	reference: (reference) => `<div class="ref">
		<span class="name">${escapeHtml(reference.name)}</span>${reference.designation ? `, ${escapeHtml(reference.designation)}` : ""}
		${reference.workPlace ? `<div>${escapeHtml(reference.workPlace)}</div>` : ""}
		<div class="sub">${[reference.phone, reference.email].filter(Boolean).map(escapeHtml).join("&ensp;•&ensp;")}</div>
	</div>`,
};
