import fs from "node:fs/promises";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
	APPLICATION_STATUSES,
	documentSchema,
	emailDraftSchema,
	fitSchema,
	REQUIREMENT_KINDS,
	unansweredQuestions,
} from "@shared/application";
import { RESUME_SECTIONS, RESUME_TEMPLATE_IDS, RESUME_TEMPLATES, resumeSchema } from "@shared/resume";
import { z } from "zod";
import { helpRequested, questionsAsked } from "../analytics";
import {
	applicationFolder,
	askApplicationQuestions,
	askInboxQuestions,
	collectUndeliveredAnswers,
	createApplication,
	getApplication,
	listApplications,
	listAsked,
	patchApplication,
} from "../applications";
import { findCredential, listCredentials, saveCredential } from "../credentials";
import { exists, readText, writeJson } from "../files";
import { requestHelp } from "../help";
import { notify } from "../notify";
import { renderHtmlToPdf, renderPdf } from "../pdf";
import { resumeFonts } from "../resume/fonts";
import { renderResume } from "../resume/render";
import { reviewResume } from "../resume/review";
import { resolveInWorkspace, workspacePaths } from "../workspace";
import { guarded } from "./result";

const applicationFields = {
	title: z.string().optional(),
	company: z.string().optional(),
	location: z.string().optional(),
	employmentType: z.string().optional(),
	salary: z.string().optional(),
	closesAt: z.string().optional().describe("Application deadline as an ISO date."),
	source: z.string().optional().describe("Where the job was found: 'dproz', 'linkedin', 'indeed', or a site name."),
	sourceJobId: z.string().optional().describe("The job's id on that source. Used to avoid duplicates."),
	jobUrl: z.string().optional().describe("Public page describing the job."),
	applyUrl: z.string().optional().describe("Where the application is actually submitted."),
	applyMethod: z.enum(["url", "email", "unknown"]).optional(),
	applyEmail: z.string().optional(),
	status: z.enum(APPLICATION_STATUSES).optional(),
	fit: fitSchema.optional().describe("Your honest fit check against about-me.md and the documents."),
	strategy: z
		.string()
		.optional()
		.describe(
			"Markdown: what will make this application the strongest one this employer reads, and how you applied it.",
		),
	documents: z
		.array(documentSchema)
		.optional()
		.describe("Files prepared for this application, paths relative to its folder. Replaces the previous list."),
	emailDraft: emailDraftSchema.optional().describe("For email applications: the message the user will send."),
	hold: z.boolean().optional().describe("True when the user asked for this job to be prepared but not sent."),
	closedReason: z.string().optional(),
	notes: z.string().optional(),
};

async function missingDocuments(id: string, documents: { file: string }[]) {
	const folder = await applicationFolder(id);
	const checks = await Promise.all(
		documents.map(async ({ file }) => ((await exists(path.join(folder, file))) ? null : file)),
	);
	return checks.filter((file) => file !== null);
}

export const deskServer = () =>
	createSdkMcpServer({
		name: "desk",
		version: "0.1.0",
		alwaysLoad: true,
		instructions:
			"The desk is the user's application board. Every job you consider gets a card through save_application, and the card is how the user sees your work, so keep its status, fit, strategy and documents current as you go.",
		tools: [
			tool(
				"list_applications",
				"List the cards on the board, newest first. Check this before adding a job so you never apply twice.",
				{ status: z.enum(APPLICATION_STATUSES).optional() },
				guarded(async ({ status }) =>
					(await listApplications())
						.filter((application) => !status || application.status === status)
						.map((application) => ({
							id: application.id,
							title: application.title,
							company: application.company,
							status: application.status,
							source: application.source,
							sourceJobId: application.sourceJobId,
							applyMethod: application.applyMethod,
							openQuestions: unansweredQuestions(application.questions).length,
							updatedAt: application.updatedAt,
						})),
				),
				{ annotations: { readOnlyHint: true } },
			),
			tool(
				"get_application",
				"Read one card in full, with its folder path and the files in it.",
				{ id: z.string() },
				guarded(async ({ id }) => {
					const application = await getApplication(id);
					const folder = await applicationFolder(id);
					return { ...application, folder, files: await fs.readdir(folder) };
				}),
				{ annotations: { readOnlyHint: true } },
			),
			tool(
				"save_application",
				"Create a card (omit id; title and company required) or update one (pass id and only the fields that changed). Creating returns the card's id and folder, where its job snapshot and tailored documents belong. A job already on the board is returned instead of duplicated.",
				{
					id: z.string().optional().describe("Omit to create. Pass to update."),
					...applicationFields,
					timelineNote: z
						.string()
						.optional()
						.describe("A short line for the card's history, e.g. 'Submitted on the careers portal'."),
				},
				guarded(async ({ id, timelineNote, ...fields }) => {
					if (!id) {
						const { title, company } = fields;
						if (!title || !company) throw new Error("title and company are required to create a card.");
						const { application, created } = await createApplication({ ...fields, title, company });
						const folder = await applicationFolder(application.id);
						await fs.mkdir(folder, { recursive: true });
						return created
							? { id: application.id, folder, created: true }
							: { id: application.id, folder, created: false, note: `Already on the board as ${application.status}.` };
					}
					const application = await patchApplication(id, fields, timelineNote);
					const missing = await missingDocuments(id, fields.documents ?? []);
					return {
						id: application.id,
						status: application.status,
						...(missing.length ? { warning: `These documents are not in the folder yet: ${missing.join(", ")}` } : {}),
					};
				}),
			),
			tool(
				"ask_user",
				`Ask the user for something only they know, when you cannot go on without it. Does not wait: the question is queued, the card moves to Needs your input, and you carry on with other work. Answers arrive through get_answers. Ask everything you must for a card in one call, and nothing you could do without.

Two kinds of question:
- A quick question closes a gap between a job and the user's resume: it asks whether they have one thing the job requires that about-me.md does not show. Set item. They answer "I have it" or "Not yet" with one click, and that is the whole answer. It cannot ask for more: there is no follow-up.
- An open question is for what needs words and a form will not take a blank for: a salary expectation, a start date, a referee. Set question.

Never ask the user to explain, quantify or expand on what is already in about-me.md. Read it first and never ask what it already answers. When the answers come back, work them into about-me.md.`,
				{
					applicationId: z
						.string()
						.optional()
						.describe("The card this blocks. Omit for a general question about the user."),
					questions: z
						.array(
							z.object({
								question: z
									.string()
									.optional()
									.describe("An open question the user can answer in a line or two. Leave out for a quick question."),
								item: z
									.string()
									.optional()
									.describe(
										"Makes this a quick question. One requirement the job states as a short label that reads naturally after 'Do you have this:', about 12 words at most: 'At least 3 years of Python', 'Bachelor's degree in Accounting, Finance or a related field', 'Power BI', 'A valid driving licence'. Keep alternatives together in one item, state years as a minimum, and ask about the requirement as the job means it, in plain words rather than the posting's sentence. Not a personal quality (teamwork, honesty) and not something a form will ask anyway.",
									),
								category: z.enum(REQUIREMENT_KINDS).optional().describe("What kind of requirement the item is."),
								why: z.string().optional().describe("What the answer unblocks."),
							}),
						)
						.min(1),
				},
				guarded(async ({ applicationId, questions }) => {
					for (const question of questions) {
						if (!question.item && !question.question?.trim()) throw new Error("Each question needs question or item.");
					}
					questionsAsked(questions, applicationId ? "application" : "general");
					if (applicationId) await askApplicationQuestions(applicationId, questions);
					else {
						await askInboxQuestions(questions);
						notify("A question for you", questions[0].question ?? `Do you have this: ${questions[0].item}?`);
					}
					return "Queued. Continue with other work; call get_answers later to pick up the reply.";
				}),
			),
			tool(
				"get_answers",
				"Collect the answers the user has given since you last checked, and see everything you have asked before. A new answer is returned once, so work it into about-me.md before moving on. documents names files in documents/ that the user attached to that answer: read them before using it. askedBefore is your record of past questions, answered or not (answer is null while one is waiting): never ask any of them again.",
				{},
				guarded(async () => {
					// Read the record first: collecting marks the new answers as delivered.
					const askedBefore = await listAsked();
					const newAnswers = await collectUndeliveredAnswers();
					return { newAnswers: newAnswers.length ? newAnswers : "None.", askedBefore };
				}),
			),
			tool(
				"request_browser_help",
				"Hand the browser to the user for a step only a person can do (a CAPTCHA, a code sent to their phone or email, a login challenge). Waits up to ten minutes while they do it in the browser window, then tells you whether they finished. Leave the page exactly where they need to act before calling.",
				{
					instruction: z.string().describe("What the user should do, in one plain sentence, naming the site."),
					applicationId: z.string().optional(),
				},
				guarded(async ({ instruction, applicationId }) => {
					const askedAt = Date.now();
					const outcome = await requestHelp(instruction, applicationId);
					helpRequested(instruction, outcome, Date.now() - askedAt);
					if (outcome === "done") return "The user says it is done. Take a fresh snapshot of the page and continue.";
					if (outcome === "declined")
						return "The user could not do it now. Use ask_user to record what is needed, then move on.";
					return "No response from the user. Use ask_user to record what is needed, then move on.";
				}),
			),
			tool(
				"get_credentials",
				"Get the saved login for a site so you can sign in. Returns the known sites when there is no match.",
				{ site: z.string().describe("Hostname or URL of the site, e.g. 'careers.example.com'.") },
				guarded(async ({ site }) => {
					const credential = await findCredential(site);
					if (credential) {
						const { username, password, notes } = credential;
						return { site: credential.site, username, password, notes };
					}
					const known = (await listCredentials()).map((entry) => entry.site);
					return { found: false, knownSites: known };
				}),
				{ annotations: { readOnlyHint: true } },
			),
			tool(
				"save_credentials",
				"Save or replace the login for a site, for example after creating an account on a careers portal.",
				{
					site: z.string(),
					username: z.string(),
					password: z.string(),
					notes: z.string().optional().describe("Anything needed next time, e.g. security answers or the email used."),
				},
				guarded(async (input) => {
					await saveCredential(input);
					return "Saved.";
				}),
			),
			tool(
				"render_resume",
				`Print a tailored resume from structured content, in one of five layouts, to a PDF. The content is also saved as resume.json beside the PDF, so to revise: read resume.json, change it, and call this again with the whole resume. Returns the page count and notes on the wording, checked against about-me.md and the posting in job.md. Fix every note and render again, unless a note is plainly mistaken about this resume. Then read the PDF to check how it looks.

Layouts:
${Object.entries(RESUME_TEMPLATES)
	.map(([id, use]) => `- ${id}: ${use}`)
	.join("\n")}

Lists are Markdown text with one "- " line for each item. Wrap a few words in **two asterisks** for bold, for example a project's name at the start of its line. Leave out any section that has nothing in it.`,
				{
					pdf: z
						.string()
						.describe("Where to save it, relative to the workspace: applications/<id>/Firstname-Lastname-Resume.pdf."),
					template: z.enum(RESUME_TEMPLATE_IDS).describe("The layout this employer would expect."),
					sectionOrder: z
						.array(z.enum(RESUME_SECTIONS))
						.optional()
						.describe(
							"Sections in order of importance for this job. The default is summary, skills, experience, education, then the rest. Sections you leave out follow in that order.",
						),
					resume: resumeSchema,
				},
				guarded(async ({ pdf, template, sectionOrder, resume }) => {
					const target = await resolveInWorkspace(pdf);
					const folder = path.dirname(target);
					const html = renderResume(resume, { template, sectionOrder }, await resumeFonts());
					const { pages } = await renderHtmlToPdf(html, target);
					const json = path.join(folder, "resume.json");
					await writeJson(json, resume);

					const { aboutMe } = await workspacePaths();
					const card = await getApplication(path.basename(folder)).catch(() => null);
					const notes = reviewResume(resume, {
						aboutMe: await readText(aboutMe),
						job: await readText(path.join(folder, "job.md")),
						company: card?.company,
						jobTitle: card?.title,
					});
					if (pages > 2) notes.unshift(`It runs to ${pages} pages. Two at most: cut what matters least for this job.`);
					if (pages === 2) {
						notes.push(
							"It runs to two pages. Right for a long career. If the second page holds only a few lines, bring it back to one: cut the least relevant lines, or use the compact layout.",
						);
					}
					return { pdf: target, json, pages, notes: notes.length ? notes : "Nothing to fix in the wording." };
				}),
			),
			tool(
				"render_pdf",
				"Print an HTML file in the workspace to a PDF next to it (A4 unless the HTML sets @page). For the cover letter and anything else that is not the resume. Returns the page count: read the PDF to check the layout before you use it.",
				{
					html: z.string().describe("HTML file, relative to the workspace or absolute inside it."),
					pdf: z.string().optional().describe("Output path. Defaults to the HTML path with a .pdf extension."),
				},
				guarded(async ({ html, pdf }) => {
					const source = await resolveInWorkspace(html);
					const target = await resolveInWorkspace(pdf ?? html.replace(/\.html?$/i, ".pdf"));
					return { pdf: target, ...(await renderPdf(source, target)) };
				}),
			),
		],
	});
