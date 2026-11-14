import { dateRange, degree, escapeHtml, fullName, languageText, links, mdToHtml, placeText, roleSkills } from "../html";
import type { Template } from "../render";

const css = `
@page { size: A4; margin: 12mm 14mm; }
:root { --ink: #1c1c1c; --muted: #4d4d4d; --faint: #666; --rule: #333; }
body { font-family: "Times New Roman", Times, Georgia, serif; font-size: 10pt; line-height: 1.36; }
header { border-bottom: 1.1pt solid var(--rule); padding-bottom: 6pt; margin-bottom: 7.5pt;
	display: flex; justify-content: space-between; align-items: flex-end; gap: 18pt; }
.id { flex: 0 0 auto; }
h1 { font-size: 17pt; font-weight: 700; line-height: 1.15; white-space: nowrap; }
.title { font-size: 10pt; color: var(--muted); margin-top: 1.5pt; }
.contact { flex: 1 1 auto; min-width: 0; font-size: 8.8pt; color: var(--muted); line-height: 1.5;
	text-align: right; overflow-wrap: anywhere; }
section { margin-top: 8.5pt; }
h2 { font-size: 11pt; text-transform: uppercase; font-weight: 700;
	border-bottom: 0.75pt solid var(--rule); padding-bottom: 1.5pt; margin-bottom: 4.5pt; }
p { margin-bottom: 3pt; }
ul { margin: 2pt 0 0; padding-left: 12pt; }
li { margin: 1.1pt 0; }
.entry { margin-bottom: 6pt; }
.entry:last-child { margin-bottom: 0; }
.row { display: flex; justify-content: space-between; gap: 8pt; align-items: baseline; }
.role { font-weight: 700; font-size: 10.6pt; }
.org { color: var(--muted); font-style: italic; font-weight: 400; }
.meta { color: var(--faint); font-size: 9.2pt; white-space: nowrap; }
.entry > p { color: var(--muted); font-size: 9.2pt; margin: 1pt 0 0; }
.rel { font-size: 9.2pt; color: var(--muted); margin: 1pt 0 0; }
.ref .name { font-weight: 700; }
.ref .sub { color: var(--muted); font-size: 9.2pt; }
`;

export const compact: Template = {
	css,
	header: (resume) => {
		const { contact } = resume;
		const rows = [
			[contact.email, contact.phone].filter(Boolean).map(escapeHtml).join("&ensp;|&ensp;"),
			escapeHtml(placeText(contact.location)),
			links(resume).map(escapeHtml).join("&ensp;|&ensp;"),
		];
		return `<header>
			<div class="id"><h1>${escapeHtml(fullName(contact))}</h1>${contact.title ? `<div class="title">${escapeHtml(contact.title)}</div>` : ""}</div>
			<div class="contact">${rows
				.filter(Boolean)
				.map((row) => `<div>${row}</div>`)
				.join("")}</div>
		</header>`;
	},
	job: (job) => {
		const place = placeText(job.location);
		return `<div class="entry">
			<div class="row"><span class="role">${escapeHtml(job.jobTitle)}<span class="org">, ${escapeHtml(job.employer)}</span></span><span class="meta">${escapeHtml(dateRange(job))}${place ? ` · ${escapeHtml(place)}` : ""}</span></div>
			${mdToHtml(job.highlights)}${roleSkills(job, "Skills")}
		</div>`;
	},
	school: (school) => `<div class="entry">
		<div class="row"><span class="role">${escapeHtml(degree(school) || school.schoolName)}${degree(school) ? `<span class="org">, ${escapeHtml(school.schoolName)}</span>` : ""}</span><span class="meta">${escapeHtml(school.graduation)}</span></div>
		${mdToHtml(school.details)}
	</div>`,
	languages: (list) => list.map((language) => languageText(language, (level) => ` (${level})`)).join("&ensp;|&ensp;"),
	reference: (reference) => `<div class="ref">
		<span class="name">${escapeHtml(reference.name)}</span>${reference.designation ? `, ${escapeHtml(reference.designation)}` : ""}${reference.workPlace ? `, ${escapeHtml(reference.workPlace)}` : ""}
		<div class="sub">${[reference.phone, reference.email].filter(Boolean).map(escapeHtml).join(" · ")}</div>
	</div>`,
};
