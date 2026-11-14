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
:root { --ink: #111; --muted: #444; --faint: #666; }
body { font-family: "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif; font-size: 10pt; line-height: 1.4; }
header { text-align: center; margin-bottom: 12pt; }
h1 { font-size: 17.5pt; font-weight: 700; text-transform: uppercase; line-height: 1.15; }
.title { font-size: 13.5pt; font-style: italic; color: var(--muted); margin: 6pt 0 7pt; }
.contact { font-size: 9.2pt; color: var(--muted); }
.summary p:last-child { margin-bottom: 0; }
section { margin-top: 11.5pt; }
h2 { font-size: 11.5pt; font-weight: 700; text-transform: uppercase; margin-bottom: 4.5pt; }
p { margin-bottom: 4pt; }
ul { margin: 2.5pt 0 0; padding-left: 13pt; }
li { margin: 1.6pt 0; }
.entry { margin-bottom: 8.5pt; }
.entry:last-child { margin-bottom: 0; }
.head { display: flex; justify-content: space-between; gap: 9pt; align-items: baseline; }
.role { font-size: 10.8pt; font-weight: 700; }
.role .org { font-weight: 400; font-style: italic; }
.dates { font-size: 9.2pt; color: var(--faint); white-space: nowrap; }
.place { font-size: 9.2pt; color: var(--faint); margin: 0.75pt 0 2pt; }
.entry > p { color: var(--muted); font-size: 9.2pt; margin: 1.5pt 0 0; }
.rel { font-size: 9.2pt; color: var(--muted); margin: 2pt 0 0; }
.rel .label { font-weight: 700; }
.ref .name { font-weight: 700; }
.ref .sub { font-size: 9.2pt; color: var(--faint); }
`;

export const executive: Template = {
	css,
	summaryInHeader: true,
	titles: {
		skills: "Areas of Expertise",
		experience: "Professional Experience",
		affiliations: "Professional Affiliations",
	},
	header: (resume) => `<header>
		<h1>${escapeHtml(fullName(resume.contact))}</h1>
		${resume.contact.title ? `<div class="title">${escapeHtml(resume.contact.title)}</div>` : ""}
		<div class="contact">${contactBits(resume).join("&ensp;·&ensp;")}</div>
	</header>
	${resume.summary?.trim() ? `<div class="summary">${mdToHtml(resume.summary)}</div>` : ""}`,
	job: (job) => {
		const place = placeText(job.location);
		return `<div class="entry">
			<div class="head"><span class="role">${escapeHtml(job.jobTitle)}<span class="org">, ${escapeHtml(job.employer)}</span></span><span class="dates">${escapeHtml(dateRange(job))}</span></div>
			${place ? `<div class="place">${escapeHtml(place)}</div>` : ""}
			${mdToHtml(job.highlights)}${roleSkills(job, "Core technologies")}
		</div>`;
	},
	school: (school) => {
		const place = placeText(school.location);
		return `<div class="entry">
			<div class="head"><span class="role">${escapeHtml(degree(school) || school.schoolName)}${degree(school) ? `<span class="org">, ${escapeHtml(school.schoolName)}</span>` : ""}</span><span class="dates">${escapeHtml(school.graduation)}</span></div>
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
