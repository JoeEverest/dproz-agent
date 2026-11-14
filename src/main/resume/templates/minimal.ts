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

// The original asks Google Fonts for Libre Franklin. A resume cannot depend on the network at print time,
// so this one uses the system sans-serif the original fell back to.
const css = `
@page { size: A4; margin: 19mm 20mm; }
:root { --ink: #0e0e0f; --muted: #1c1c1c; --faint: #3f3f3f; --rule: #c8c8c8; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
	font-size: 10pt; line-height: 1.4; }
header { margin-bottom: 19pt; text-align: center; }
h1 { font-size: 20.5pt; font-weight: 700; line-height: 1.15; }
.title { font-size: 12pt; color: var(--muted); margin-top: 4pt; font-weight: 500; }
.contact { font-size: 9.6pt; color: var(--muted); margin-top: 9pt; }
section { margin-top: 16.5pt; }
h2 { font-size: 10pt; font-weight: 700; text-transform: uppercase;
	margin-bottom: 7.5pt; padding-bottom: 4.5pt; border-bottom: 1.1pt solid var(--ink); }
p { margin-bottom: 5pt; }
ul { margin: 4pt 0 0; padding-left: 12pt; }
li { margin: 2.2pt 0; padding-left: 1.5pt; }
.entry { margin-bottom: 12pt; }
.entry:last-child { margin-bottom: 0; }
.head { display: flex; justify-content: space-between; gap: 11pt; align-items: baseline; }
.role { font-size: 10.8pt; font-weight: 700; }
.role .org { font-weight: 500; color: var(--muted); }
.dates { font-size: 9pt; color: var(--faint); white-space: nowrap; }
.place { font-size: 9pt; color: var(--faint); margin: 0.75pt 0 3pt; }
.entry > p { color: var(--faint); font-size: 9.2pt; margin: 1.5pt 0 0; }
.rel { font-size: 9pt; color: var(--muted); margin: 2.5pt 0 0; }
.rel .label { color: var(--faint); }
.ref .name { font-weight: 600; }
.ref .sub { color: var(--faint); font-size: 9pt; }
`;

export const minimal: Template = {
	css,
	header: (resume) => `<header>
		<h1>${escapeHtml(fullName(resume.contact))}</h1>
		${resume.contact.title ? `<div class="title">${escapeHtml(resume.contact.title)}</div>` : ""}
		<div class="contact">${contactBits(resume).join(" | ")}</div>
	</header>`,
	job: (job) => {
		const place = placeText(job.location);
		return `<div class="entry">
			<div class="head"><span class="role">${escapeHtml(job.jobTitle)}<span class="org"> · ${escapeHtml(job.employer)}</span></span><span class="dates">${escapeHtml(dateRange(job))}</span></div>
			${place ? `<div class="place">${escapeHtml(place)}</div>` : ""}
			${mdToHtml(job.highlights)}${roleSkills(job, "Relevant skills")}
		</div>`;
	},
	school: (school) => {
		const place = placeText(school.location);
		return `<div class="entry">
			<div class="head"><span class="role">${escapeHtml(degree(school) || school.schoolName)}${degree(school) ? `<span class="org"> · ${escapeHtml(school.schoolName)}</span>` : ""}</span><span class="dates">${escapeHtml(school.graduation)}</span></div>
			${place ? `<div class="place">${escapeHtml(place)}</div>` : ""}
			${mdToHtml(school.details)}
		</div>`;
	},
	languages: (list) => list.map((language) => languageText(language, (level) => ` (${level})`)).join("&ensp;·&ensp;"),
	reference: (reference) => `<div class="ref">
		<span class="name">${escapeHtml(reference.name)}</span>${reference.designation ? `, ${escapeHtml(reference.designation)}` : ""}
		${reference.workPlace ? `<div>${escapeHtml(reference.workPlace)}</div>` : ""}
		<div class="sub">${[reference.phone, reference.email].filter(Boolean).map(escapeHtml).join("&ensp;·&ensp;")}</div>
	</div>`,
};
