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

export const questionSchema = z.object({
	id: z.string(),
	question: z.string(),
	why: z.string().optional(),
	answer: z.string().optional(),
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
