import { z } from "zod";

/** The layouts a resume can be printed in. Ported from the resume tailoring in Dproz Fit Check. */
export const RESUME_TEMPLATES = {
	classic: "Serif, centred name, ruled headings. Government, banking, law, academia, NGOs and other formal employers.",
	modern: "Sans-serif, left-aligned. Technology, business and most private-sector roles.",
	compact: "Dense serif with the name left and contact details right. A long history that has to fit the page.",
	minimal: "Sans-serif, centred, with more white space. Design and product roles, and shorter resumes.",
	executive: "Palatino, name in capitals, the summary straight under it. Senior and management roles.",
} as const;

export type ResumeTemplateId = keyof typeof RESUME_TEMPLATES;
export const RESUME_TEMPLATE_IDS = Object.keys(RESUME_TEMPLATES) as [ResumeTemplateId, ...ResumeTemplateId[]];

/** Sections that can be reordered. The header always comes first. */
export const RESUME_SECTIONS = [
	"summary",
	"skills",
	"experience",
	"education",
	"certifications",
	"custom",
	"accomplishments",
	"affiliations",
	"languages",
	"additional",
	"references",
] as const;

export type ResumeSection = (typeof RESUME_SECTIONS)[number];

const text = (what?: string) => (what ? z.string().nullish().describe(what) : z.string().nullish());
const list = (what: string) => text(`${what} Markdown, one "- " line for each item.`);

const location = z.object({ city: text(), region: text(), country: text() }).nullish();

/**
 * A resume as data. The shape is the master resume of the Dproz AI service (the one Fit Check tailors),
 * so a resume from there prints here unchanged: lists are Markdown strings, not arrays.
 */
export const resumeSchema = z.object({
	contact: z.object({
		firstName: z.string(),
		middleName: text(),
		lastName: z.string(),
		title: text("The professional headline under the name."),
		email: text(),
		phone: text(),
		location,
	}),
	summary: text(),
	skills: list('The skills section. A line may be labelled: "- Databases: PostgreSQL, Redis".'),
	workExperience: z
		.array(
			z.object({
				jobTitle: z.string(),
				employer: z.string(),
				location,
				startDate: text('As "Aug 2024". The same format everywhere.'),
				endDate: text("Empty for a job they still hold."),
				current: z.boolean().nullish(),
				highlights: list(
					"The bullets. A first line without a marker prints as a short note saying what the employer or product is.",
				),
				relevantSkills: list("Skills used in this role, printed as one line under it. Usually empty."),
			}),
		)
		.nullish()
		.describe("Most recent first."),
	education: z
		.array(
			z.object({
				schoolName: z.string(),
				location,
				educationLevel: text("The degree or qualification, as it was awarded."),
				fieldOfStudy: text(),
				graduation: text('A date or a range: "2018", "Nov 2019 – Nov 2022".'),
				details: list("Honours, a thesis, relevant coursework."),
			}),
		)
		.nullish(),
	certifications: list("Certifications and licences, with the year."),
	languages: z.array(z.object({ language: z.string(), proficiency: text() })).nullish(),
	accomplishments: list("Awards and recognition that belong to no single job."),
	affiliations: list("Professional bodies."),
	personalLinks: z
		.array(z.object({ type: text('"LinkedIn", "GitHub", "Portfolio".'), value: z.string() }))
		.nullish()
		.describe("Printed with the contact details. The value without https://."),
	references: z
		.array(
			z.object({
				name: z.string(),
				designation: text(),
				workPlace: text(),
				location,
				phone: text(),
				email: text(),
			}),
		)
		.nullish(),
	additionalInfo: list("Facts a posting asks for outright: citizenship, availability, a driving licence."),
	customSections: z
		.array(
			z.object({
				title: z.string(),
				content: z.string().describe('Markdown. Start a titled entry with its name in bold: "- **Name**: what it is".'),
			}),
		)
		.nullish()
		.describe("Sections of their own, such as Projects or Publications."),
});

export type Resume = z.infer<typeof resumeSchema>;
