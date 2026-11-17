import { z } from "zod";

export const APPLICATION_STATUSES = [
	"found",
	"needs_input",
	"ready_to_submit",
	"manual",
	"applied",
	"interview",
	"closed",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
	found: "Found",
	needs_input: "Needs your input",
	ready_to_submit: "Ready to submit",
	manual: "Apply manually",
	applied: "Applied",
	interview: "Interview",
	closed: "Closed",
};

/** What a quick question can be about: the four kinds of requirement Dproz Fit Check assesses. */
export const REQUIREMENT_KINDS = ["experience", "skills", "education", "certifications"] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_LABELS: Record<RequirementKind, string> = {
	experience: "Work experience",
	skills: "Skills",
	education: "Education",
	certifications: "Certifications",
};

export const questionSchema = z.object({
	id: z.string(),
	question: z.string(),
	why: z.string().optional(),
	// A quick question asks whether the user has one thing a job requires, and is answered with one
	// click. That is all it asks: anything that needs words is an ordinary question.
	item: z.string().optional(),
	category: z.enum(REQUIREMENT_KINDS).optional(),
	have: z.boolean().optional(),
	answer: z.string().optional(),
	// Names in documents/ of the files the user attached to their answer.
	documents: z.array(z.string()).optional(),
	// Links to pages the user wrote in their answer, kept with their other links.
	links: z.array(z.string()).optional(),
	askedAt: z.string(),
	answeredAt: z.string().optional(),
	deliveredAt: z.string().optional(),
});

export const fitSchema = z.object({
	verdict: z.enum(["strong", "good", "stretch", "poor"]),
	summary: z.string(),
	strengths: z.array(z.string()).default([]),
	gaps: z.array(z.string()).default([]),
});

export const documentSchema = z.object({
	label: z.string(),
	file: z.string(),
});

export const emailDraftSchema = z.object({
	to: z.string(),
	subject: z.string(),
	body: z.string(),
});

export const timelineEventSchema = z.object({
	at: z.string(),
	event: z.string(),
});

export const applicationSchema = z.object({
	id: z.string(),
	title: z.string(),
	company: z.string(),
	location: z.string().optional(),
	employmentType: z.string().optional(),
	salary: z.string().optional(),
	closesAt: z.string().optional(),
	source: z.string().default("web"),
	sourceJobId: z.string().optional(),
	jobUrl: z.string().optional(),
	applyUrl: z.string().optional(),
	applyMethod: z.enum(["url", "email", "unknown"]).default("unknown"),
	applyEmail: z.string().optional(),
	status: z.enum(APPLICATION_STATUSES),
	fit: fitSchema.optional(),
	strategy: z.string().optional(),
	documents: z.array(documentSchema).default([]),
	questions: z.array(questionSchema).default([]),
	emailDraft: emailDraftSchema.optional(),
	hold: z.boolean().optional(),
	closedReason: z.string().optional(),
	notes: z.string().optional(),
	timeline: z.array(timelineEventSchema).default([]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Question = z.infer<typeof questionSchema>;
export type Fit = z.infer<typeof fitSchema>;
export type ApplicationDocument = z.infer<typeof documentSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type Application = z.infer<typeof applicationSchema>;

export const unansweredQuestions = (questions: Question[]) => questions.filter((question) => !question.answer);

/** A click on "I have it" or "Not yet" for a quick question, or the text of an answer to an open one. */
export type QuestionReply = string | { have: boolean };

/** A quick question that still needs its one-click answer. */
export const awaitingChoice = (question: Question) =>
	Boolean(question.item) && question.have === undefined && !question.answer;

/** What an answer made only of attached files is recorded as. */
export const attachedAnswer = (names: string[]) => `Attached ${names.join(", ")}.`;

/** What a one-click answer is recorded as. */
export const haveAnswer = (have: boolean) => (have ? "I have it." : "I do not have it.");
