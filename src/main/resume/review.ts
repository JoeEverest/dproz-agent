/**
 * Notes on a resume's wording, for the writer to act on before the judge sees it.
 *
 * Two sets of rules meet here. The form of a bullet comes from the career services that publish their
 * guidance (Harvard, Yale, MIT): open with a verb, one accomplishment, a line or two, no first person,
 * no padding. The rules about what may be claimed come from the Dproz AI service, which tailors
 * resumes for Fit Check: the candidate's own figures and words, never the posting's thresholds or
 * sentences, and skills as short names of real skills. Its checks are ported from its eval harness.
 *
 * These are the faults a program can see. Whether a bullet is true and whether it is the right one
 * for the job stay with the writer and the judge.
 */
import type { Resume } from "@shared/resume";
import { mdBullets, mdLines } from "./html";

/** What a resume is checked against. Every part is optional: a check with nothing to compare to is skipped. */
export type Evidence = {
	/** The user's master resume, about-me.md: everything they have said about themselves. */
	aboutMe?: string;
	/** The posting. */
	job?: string;
	company?: string;
	jobTitle?: string;
};

const MAX_BULLET = 200;
const MAX_BULLETS = 6;
const MAX_SUMMARY_WORDS = 80;
const MAX_SUMMARY_SENTENCES = 4;

// "I" only where it is a pronoun: "Level I" and "Phase I" are not.
const FIRST_PERSON =
	/(^|[.;:,]\s+|\b(and|that|where|which|when|as)\s+)I\s+[a-z]|\bI'(m|ve|d)\b|\b([Mm]y|[Mm]yself|[Ww]e|[Oo]ur)\b/;
const DUTY_OPENERS =
	/^(responsible for|helped|worked (on|with|in|as)|assisted|did|participated|involved in|tasked with|duties|in charge of|utili[sz]ed)\b/i;
const PADDING = [
	"results-driven",
	"results-oriented",
	"passionate",
	"proven track record",
	"detail-oriented",
	"team player",
	"hard-working",
	"hardworking",
	"highly motivated",
	"self-starter",
	"seamless",
	"synergy",
	"cutting-edge",
	"fast-paced",
	"empower",
	"leverag",
	"go-getter",
	"think outside the box",
	"excellent communication skills",
];

// The posting's threshold or range, written as if it were the user's own experience.
const THRESHOLDS = [
	/\b(at least|a minimum of|minimum of|minimum|not less than)\s+\w+(-\w+)?\s*\+?\s*(years?|yrs?)\b/gi,
	/\b\d+\s*\+?\s*(years?|yrs?)\s+or more\b/gi,
	/\b\d+\s*(?:–|-|to)\s*\d+\s*(?:years?|yrs?)\b/gi,
	/\bentry[- ]level (experience|professional|candidate|role|position)\b/gi,
];

const DEGREE_LEVELS = [
	{
		level: "doctorate",
		claim: /\b(ph\.?\s?d|doctorate|doctoral degree)\b/i,
		shown: /\b(ph\.?\s?d|doctorate|doctoral|doctor of)\b/i,
	},
	{
		level: "master's degree",
		claim: /(?<!scrum\s)\b(master'?s\b|masters\b|master of\b|master degree|m\.?\s?sc\b|mba\b|postgraduate degree)/i,
		shown:
			/\b(master'?s\b|masters\b|master of\b|master degree\b|m\.?\s?sc\b|mba\b|m\.?\s?a\b|m\.?\s?eng\b|llm\b|postgraduate)/i,
	},
	{
		level: "bachelor's degree",
		claim: /\b(bachelor'?s?\b|undergraduate degree|b\.?\s?sc\b|b\.?\s?eng\b|llb\b|b\.?\s?com\b)/i,
		shown:
			/\b(bachelor|b\.?\s?sc\b|b\.?\s?a\b|b\.?\s?ed\b|b\.?\s?eng\b|b\.?\s?tech\b|llb\b|b\.?\s?com\b|bba\b|b\.?\s?acc|undergraduate)/i,
	},
];

// What does not belong in a skills list: conditions of eligibility, personal traits, and sentences
// lifted from a posting.
const ELIGIBILITY =
	/\b(citizen(ship)?|nationality|aged?\s+(between\s+)?\d+|years of age|guarantors?|birth certificate|transcripts?|curriculum vitae|nida|national id|criminal record|good conduct|resident of|residency)\b/i;
const TRAIT =
	/^(honest(y)?|integrity|trustworth(y|iness)|professionalism|presentable|patience|reliable|reliability|punctual(ity)?|disciplined?|loyal(ty)?|dedicated|dedication|enthusiastic|enthusiasm|confident|self[- ]?(driven|motivated|confidence)|hard[- ]?working|proactive|responsible|ambitious|adaptable|positive attitude|committed|commitment|innovative|results[- ]oriented|team ?work|communication( skills)?|attention to detail|problem[- ]solving|time management|interpersonal skills)$/i;
const REQUIREMENT_SENTENCE =
	/^(ability to|able to|knowledge of|understanding of|familiarity with|experience (in|with)|proven|minimum|at least|must|should|demonstrated|track record|strong (knowledge|understanding|ability)|good (knowledge|understanding)|capacity to)\b/i;

const quote = (text: string) => `"${text.length > 70 ? `${text.slice(0, 67).trimEnd()}…` : text}"`;
const firstWord = (text: string) => text.match(/^[A-Za-z][A-Za-z-]*/)?.[0].toLowerCase() ?? "";

function normalize(text?: string | null) {
	return (text ?? "")
		.toLowerCase()
		.replace(/[‘’`]/g, "'")
		.replace(/[^a-z0-9+#.'\s]/g, " ")
		.replace(/\.(?=\s|$)/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const words = (text?: string | null) => normalize(text).split(" ").filter(Boolean);

function ngrams(text: string, size: number) {
	const all = words(text);
	const grams = new Set<string>();
	for (let start = 0; start + size <= all.length; start++) grams.add(all.slice(start, start + size).join(" "));
	return grams;
}

function containsPhrase(haystack: string, needle: string) {
	const wanted = normalize(needle);
	return wanted.length > 0 && ` ${normalize(haystack)} `.includes(` ${wanted} `);
}

/** A skills section as single skills: "Languages: Java, Python" gives "Java" and "Python". */
function skillEntries(markdown?: string | null) {
	return mdLines(markdown).flatMap((line) => {
		const rest = line.replace(/\*\*/g, "").replace(/^[^:]{1,40}:\s*/, "");
		const items = rest
			.split(/[,;](?![^(]*\))/)
			.map((item) =>
				item
					.trim()
					.replace(/^(and|or|&)\s+/i, "")
					.replace(/\.$/, ""),
			)
			.filter(Boolean);
		return items.length > 1 && items.every((item) => item.split(/\s+/).length <= 6) ? items : [rest];
	});
}

function dateStyle(date?: string | null) {
	if (!date || /^may\b/i.test(date)) return null;
	if (/^[A-Za-z]{3}\.? \d{4}$/.test(date)) return "Aug 2024";
	if (/^[A-Za-z]{4,} \d{4}$/.test(date)) return "August 2024";
	if (/^\d{1,2}[/-]\d{4}$/.test(date)) return "08/2024";
	return null;
}

/** Figures that are easy to make up: a percentage, an amount of money, or a count of ten or more. */
function figures(text: string) {
	const found = new Set<string>();
	for (const match of text.matchAll(/(?:(?:[$£€]|tsh|tzs|usd|kes|ugx)\s?)?\d[\d,]*(?:\.\d+)?\s?%?/gi)) {
		const digits = match[0].replace(/[^\d.]/g, "").replace(/\.$/, "");
		if (!digits) continue;
		const marked = /[%$£€]|tsh|tzs|usd|kes|ugx/i.test(match[0]);
		if (marked || Number(digits) >= 10) found.add(digits);
	}
	return [...found];
}

export function reviewResume(resume: Resume, evidence: Evidence = {}): string[] {
	const notes: string[] = [];
	const jobs = resume.workExperience ?? [];
	const summary = resume.summary ?? "";
	const bulletsOf = (job: (typeof jobs)[number]) => mdBullets(job.highlights);
	const allBullets = jobs.flatMap(bulletsOf);
	const known = (evidence.aboutMe ?? "").trim();
	const prose = [
		summary,
		...jobs.flatMap((job) => mdLines(job.highlights)),
		...(resume.customSections ?? []).flatMap((section) => [section.title, ...mdLines(section.content)]),
		...mdLines(resume.accomplishments),
		...mdLines(resume.additionalInfo),
	].filter(Boolean);

	// --- Form: what the career-service guides agree on.

	for (const text of prose) {
		if (FIRST_PERSON.test(text))
			notes.push(`${quote(text)} is in the first person. A resume has no "I", "my" or "we".`);
	}
	const lowered = prose.join("\n").toLowerCase();
	for (const phrase of PADDING) {
		if (lowered.includes(phrase) && !known.toLowerCase().includes(phrase)) {
			notes.push(`"${phrase}" is padding. Put the fact it stands for in its place, or cut it.`);
		}
	}
	if (prose.some((text) => text.includes("—")))
		notes.push("There is an em dash in the text. Use a comma or a full stop.");

	const summaryWords = words(summary).length;
	const sentences = summary.split(/[.!?](?:\s|$)/).filter((part) => part.trim()).length;
	if (summaryWords > MAX_SUMMARY_WORDS || sentences > MAX_SUMMARY_SENTENCES) {
		notes.push(`The summary is ${sentences} sentences and ${summaryWords} words. Three or four sentences at most.`);
	}

	for (const job of jobs) {
		const role = `${job.jobTitle} at ${job.employer}`;
		const lines = bulletsOf(job);
		for (const line of lines) {
			if (line.length > MAX_BULLET) {
				notes.push(`${quote(line)} runs past two lines (${line.length} characters). One accomplishment, said shorter.`);
			}
			if (/[.!?]\s+[A-Z]/.test(line)) {
				notes.push(`${quote(line)} is more than one sentence. A bullet is one phrase about one accomplishment.`);
			}
			const duty = line.match(DUTY_OPENERS)?.[0];
			if (duty) notes.push(`${quote(line)} opens with "${duty}", which names a duty. Open with what the user did.`);
		}
		if (lines.length > MAX_BULLETS) {
			notes.push(
				`${role} has ${lines.length} bullets. Keep the ${MAX_BULLETS} or fewer that matter most for this job.`,
			);
		}
		const openers = new Map<string, number>();
		for (const line of lines) openers.set(firstWord(line), (openers.get(firstWord(line)) ?? 0) + 1);
		for (const [verb, count] of openers) {
			if (verb && count > 1)
				notes.push(`${role}: ${count} bullets open with "${verb}". Use a different verb for each.`);
		}
		if (lines.length >= 3 && !lines.some((line) => /\d/.test(line))) {
			notes.push(
				`${role}: no bullet has a number. If about-me.md gives a scale or a result for this work, use it. Do not invent one.`,
			);
		}
	}

	const styles = new Set(jobs.flatMap((job) => [dateStyle(job.startDate), dateStyle(job.endDate)]).filter(Boolean));
	if (styles.size > 1) notes.push(`Dates are written in more than one format (${[...styles].join(", ")}). Use one.`);

	// --- Claims: what the Dproz AI service holds a tailored resume to.

	const claims = [summary, resume.skills ?? "", ...allBullets].join("\n");
	for (const pattern of THRESHOLDS) {
		for (const match of claims.matchAll(pattern)) {
			if (!containsPhrase(known, match[0])) {
				notes.push(
					`"${match[0]}" is how a posting states a requirement. Give the user's own figure from their history, or leave it out.`,
				);
			}
		}
	}

	if (known) {
		const knownFigures = new Set(figures(known));
		for (const text of [summary, ...allBullets]) {
			const unknown = figures(text).filter((figure) => !knownFigures.has(figure));
			if (unknown.length) {
				notes.push(
					`${quote(text)} gives ${unknown.join(", ")}, which is not in about-me.md. Keep it only if the user's documents say so, and then add it to about-me.md.`,
				);
			}
		}
	}

	const education = (resume.education ?? [])
		.flatMap((school) => [school.educationLevel, school.fieldOfStudy, school.schoolName, school.details])
		.join("\n");
	for (const degree of DEGREE_LEVELS) {
		if (degree.claim.test(summary) && !degree.shown.test(education)) {
			notes.push(`The summary claims a ${degree.level} that the education section does not show.`);
		}
	}

	if (evidence.company && normalize(evidence.company).length > 2) {
		if (containsPhrase(summary, evidence.company) && !containsPhrase(known, evidence.company)) {
			notes.push(
				`The summary names the employer being applied to (${evidence.company}). That belongs in the cover letter.`,
			);
		}
	}
	if (evidence.jobTitle && known && !containsPhrase(known, evidence.jobTitle)) {
		if (containsPhrase(`${resume.contact.title ?? ""}\n${summary}`, evidence.jobTitle)) {
			notes.push(
				`"${evidence.jobTitle}" is the title of the job, and the user has not held it. The headline and summary give their own title.`,
			);
		}
	}

	if (evidence.job) {
		const posted = ngrams(evidence.job, 5);
		const theirs = ngrams(known, 5);
		const copied = [...ngrams(claims, 5)].filter((gram) => posted.has(gram) && !theirs.has(gram));
		for (const gram of copied.slice(0, 3)) {
			notes.push(`"${gram}" is the posting's wording. A requirement is a fact to show, not words to copy.`);
		}
	}

	for (const skill of skillEntries(resume.skills)) {
		if (ELIGIBILITY.test(skill)) {
			notes.push(`"${skill}" is a condition of eligibility, not a skill. It goes in additionalInfo.`);
		} else if (TRAIT.test(skill.trim())) {
			notes.push(`"${skill}" is a personal quality, not a skill. Leave it out of the skills.`);
		} else if (REQUIREMENT_SENTENCE.test(skill) || skill.split(/\s+/).length > 7 || /,[^,]*\bor\b/i.test(skill)) {
			notes.push(`${quote(skill)} is requirement text, not the name of a skill. Name the skill in a few words.`);
		}
	}

	return notes;
}
