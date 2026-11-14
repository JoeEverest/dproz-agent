import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type Application,
	type ApplicationStatus,
	applicationSchema,
	haveAnswer,
	type Question,
	type QuestionReply,
	questionSchema,
	type RequirementKind,
	STATUS_LABELS,
} from "@shared/application";
import { z } from "zod";
import { broadcast } from "./events";
import { exists, readJson, writeJson } from "./files";
import { ensureWorkspace, workspacePaths } from "./workspace";

export type NewQuestion = {
	question?: string;
	why?: string;
	item?: string;
	category?: RequirementKind;
};

export type ApplicationPatch = Partial<Omit<Application, "id" | "questions" | "timeline" | "createdAt" | "updatedAt">>;

export type AnsweredQuestion = {
	applicationId?: string;
	application?: string;
	question: string;
	answer: string;
	item?: string;
	have?: boolean;
};

type StatusListener = (application: Application, previous: ApplicationStatus | null) => void;

const statusListeners = new Set<StatusListener>();

export function onStatusChange(listener: StatusListener) {
	statusListeners.add(listener);
	return () => statusListeners.delete(listener);
}

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
	const next = queue.then(task, task);
	queue = next.catch(() => undefined);
	return next;
}

const now = () => new Date().toISOString();

const applicationFile = (applicationsDir: string, id: string) => path.join(applicationsDir, id, "application.json");

export function slugify(text: string) {
	return (
		text
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64)
			.replace(/-+$/, "") || "application"
	);
}

async function readApplication(applicationsDir: string, id: string): Promise<Application | null> {
	const raw = await readJson<unknown>(applicationFile(applicationsDir, id), null);
	if (!raw) return null;
	const parsed = applicationSchema.safeParse({ ...(raw as object), id });
	if (!parsed.success) {
		console.warn(`Skipping ${id}/application.json: ${z.prettifyError(parsed.error)}`);
		return null;
	}
	return parsed.data;
}

export async function listApplications(): Promise<Application[]> {
	const { applications } = await ensureWorkspace();
	const entries = await fs.readdir(applications, { withFileTypes: true });
	const loaded = await Promise.all(
		entries.filter((entry) => entry.isDirectory()).map((entry) => readApplication(applications, entry.name)),
	);
	return loaded
		.filter((application): application is Application => application !== null)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getApplication(id: string): Promise<Application> {
	const { applications } = await workspacePaths();
	const application = await readApplication(applications, id);
	if (!application) throw new Error(`No application with id "${id}". Use list_applications to see valid ids.`);
	return application;
}

export async function applicationFolder(id: string) {
	const { applications } = await workspacePaths();
	return path.join(applications, id);
}

async function persist(application: Application, previous: ApplicationStatus | null) {
	const { applications } = await workspacePaths();
	const saved = applicationSchema.parse({ ...application, updatedAt: now() });
	await writeJson(applicationFile(applications, saved.id), saved);
	if (previous !== saved.status) for (const listener of statusListeners) listener(saved, previous);
	return saved;
}

function sameJob(existing: Application, candidate: ApplicationPatch) {
	if (candidate.sourceJobId && existing.sourceJobId) {
		return existing.source === (candidate.source ?? "web") && existing.sourceJobId === candidate.sourceJobId;
	}
	return Boolean(candidate.jobUrl) && existing.jobUrl === candidate.jobUrl;
}

export type CreateResult = { application: Application; created: boolean };

export function createApplication(input: ApplicationPatch & { title: string; company: string }): Promise<CreateResult> {
	return serialized(async () => {
		const { applications } = await ensureWorkspace();
		const duplicate = (await listApplications()).find((existing) => sameJob(existing, input));
		if (duplicate) return { application: duplicate, created: false };

		const base = slugify(`${input.company} ${input.title}`);
		let id = base;
		for (let copy = 2; await exists(path.join(applications, id)); copy++) id = `${base}-${copy}`;

		const createdAt = now();
		const application = await persist(
			applicationSchema.parse({
				...input,
				id,
				status: input.status ?? "found",
				timeline: [{ at: createdAt, event: "Found" }],
				createdAt,
				updatedAt: createdAt,
			}),
			null,
		);
		return { application, created: true };
	});
}

export function patchApplication(id: string, patch: ApplicationPatch, note?: string): Promise<Application> {
	return serialized(async () => {
		const current = await getApplication(id);
		const timeline = [...current.timeline];
		if (patch.status && patch.status !== current.status) {
			timeline.push({ at: now(), event: `Moved to ${STATUS_LABELS[patch.status]}` });
		}
		if (note) timeline.push({ at: now(), event: note });
		return persist({ ...current, ...patch, timeline }, current.status);
	});
}

function toQuestions(questions: NewQuestion[]): Question[] {
	return questions.map(({ question, item, ...rest }) =>
		questionSchema.parse({
			...rest,
			item,
			id: randomUUID(),
			question: question?.trim() || `Do you have this: ${item}?`,
			askedAt: now(),
		}),
	);
}

/** Two wordings of one requirement, compared loosely: "Power BI" and "power-bi" are the same thing. */
const itemKey = (item: string) =>
	item
		.toLowerCase()
		.replace(/[^a-z0-9+#]+/g, " ")
		.trim();

export const sameItem = (a?: string, b?: string) => Boolean(a && b) && itemKey(a ?? "") === itemKey(b ?? "");

/** A question after the user replies: a click on a quick question, or the text of an answer to an open one. */
export function applyReply(question: Question, reply: QuestionReply): Question {
	const settled = (fields: Partial<Question>) => ({
		...question,
		...fields,
		answeredAt: now(),
		deliveredAt: undefined,
	});
	if (typeof reply !== "string") return settled({ have: reply.have, answer: haveAnswer(reply.have) });
	return settled({ answer: reply.trim() });
}

/**
 * Gives a quick question's answer to the same question wherever else it is waiting, so the user
 * answers a requirement once however many jobs ask for it.
 */
async function shareAnswer(question: Question) {
	const { item, have, answer } = question;
	if (!answer || !item) return;

	const waiting = (other: Question) => other.id !== question.id && !other.answer && sameItem(other.item, item);
	const copy = (other: Question) =>
		waiting(other) ? { ...other, have, answer, answeredAt: now(), deliveredAt: undefined } : other;
	const inbox = await listInbox();
	if (inbox.some(waiting)) await saveInbox(inbox.map(copy));
	for (const application of await listApplications()) {
		if (!application.questions.some(waiting)) continue;
		await persist({ ...application, questions: application.questions.map(copy) }, application.status);
	}
}

export function askApplicationQuestions(id: string, questions: NewQuestion[]): Promise<Application> {
	return serialized(async () => {
		const current = await getApplication(id);
		const timeline = [...current.timeline, { at: now(), event: "Asked you a question" }];
		return persist(
			{ ...current, status: "needs_input", questions: [...current.questions, ...toQuestions(questions)], timeline },
			current.status,
		);
	});
}

export function answerApplicationQuestion(id: string, questionId: string, reply: QuestionReply): Promise<Application> {
	return serialized(async () => {
		const current = await getApplication(id);
		const questions = current.questions.map((question) =>
			question.id === questionId ? applyReply(question, reply) : question,
		);
		const saved = await persist({ ...current, questions }, current.status);
		const answered = questions.find((question) => question.id === questionId);
		if (answered) await shareAnswer(answered);
		return saved;
	});
}

export async function removeApplication(id: string) {
	const folder = await applicationFolder(id);
	await fs.rm(folder, { recursive: true, force: true });
}

export async function listInbox(): Promise<Question[]> {
	const { inbox } = await workspacePaths();
	return z
		.array(questionSchema)
		.catch([])
		.parse(await readJson<unknown>(inbox, []));
}

async function saveInbox(questions: Question[]) {
	const { inbox } = await workspacePaths();
	await writeJson(inbox, questions);
	broadcast("inbox:changed", undefined);
	return questions;
}

export function askInboxQuestions(questions: NewQuestion[]): Promise<Question[]> {
	return serialized(async () => saveInbox([...(await listInbox()), ...toQuestions(questions)]));
}

export function answerInboxQuestion(questionId: string, reply: QuestionReply): Promise<Question[]> {
	return serialized(async () => {
		const questions = (await listInbox()).map((question) =>
			question.id === questionId ? applyReply(question, reply) : question,
		);
		await saveInbox(questions);
		const answered = questions.find((question) => question.id === questionId);
		if (answered) await shareAnswer(answered);
		return listInbox();
	});
}

const awaitingDelivery = (question: Question) => Boolean(question.answer) && !question.deliveredAt;

export async function hasUndeliveredAnswers() {
	const [inbox, applications] = await Promise.all([listInbox(), listApplications()]);
	return (
		inbox.some(awaitingDelivery) || applications.some((application) => application.questions.some(awaitingDelivery))
	);
}

export function collectUndeliveredAnswers(): Promise<AnsweredQuestion[]> {
	return serialized(async () => {
		const deliveredAt = now();
		const answers: AnsweredQuestion[] = [];
		const deliver = (question: Question, origin: Pick<AnsweredQuestion, "applicationId" | "application">) => {
			if (!awaitingDelivery(question)) return question;
			const { item, have } = question;
			answers.push({ ...origin, question: question.question, answer: question.answer ?? "", item, have });
			return { ...question, deliveredAt };
		};

		const inbox = await listInbox();
		const deliveredInbox = inbox.map((question) => deliver(question, {}));
		if (inbox.some(awaitingDelivery)) await saveInbox(deliveredInbox);

		for (const application of await listApplications()) {
			if (!application.questions.some(awaitingDelivery)) continue;
			const origin = { applicationId: application.id, application: `${application.title} at ${application.company}` };
			const questions = application.questions.map((question) => deliver(question, origin));
			await persist({ ...application, questions }, application.status);
		}
		return answers;
	});
}

export type AskedQuestion = { question: string; answer: string | null; application?: string };

/**
 * Everything the agent has asked, newest last, with the answer if there is one. This is how it knows
 * not to ask again: nothing about its questions is written into the user's master resume.
 */
export async function listAsked(limit = 60): Promise<AskedQuestion[]> {
	const [inbox, applications] = await Promise.all([listInbox(), listApplications()]);
	const asked = [
		...inbox.map((question) => ({ question, application: undefined as string | undefined })),
		...applications.flatMap((application) =>
			application.questions.map((question) => ({
				question,
				application: `${application.title} at ${application.company}`,
			})),
		),
	];
	return asked
		.sort((a, b) => a.question.askedAt.localeCompare(b.question.askedAt))
		.slice(-limit)
		.map(({ question, application }) => ({
			question: question.item ? `Do you have this: ${question.item}?` : question.question,
			answer: question.answer ?? null,
			...(application ? { application } : {}),
		}));
}

let stopWatching: (() => void) | null = null;

export async function watchApplications() {
	stopWatching?.();
	const { applications } = await ensureWorkspace();
	let pending: NodeJS.Timeout | null = null;
	const watcher = watch(applications, { recursive: true }, (_event, file) => {
		if (file && !file.toString().endsWith("application.json") && file.toString().includes(path.sep)) return;
		if (pending) clearTimeout(pending);
		pending = setTimeout(() => broadcast("applications:changed", undefined), 120);
	});
	stopWatching = () => watcher.close();
	broadcast("applications:changed", undefined);
}
