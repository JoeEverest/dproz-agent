import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type Application,
	type ApplicationStatus,
	applicationSchema,
	type Question,
	questionSchema,
	STATUS_LABELS,
} from "@shared/application";
import { z } from "zod";
import { broadcast } from "./events";
import { exists, readJson, writeJson } from "./files";
import { ensureWorkspace, workspacePaths } from "./workspace";

export type NewQuestion = { question: string; why?: string };

export type ApplicationPatch = Partial<Omit<Application, "id" | "questions" | "timeline" | "createdAt" | "updatedAt">>;

export type AnsweredQuestion = { applicationId?: string; application?: string; question: string; answer: string };

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
	return questions.map(({ question, why }) =>
		questionSchema.parse({ id: randomUUID(), question, why, askedAt: now() }),
	);
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

export function answerApplicationQuestion(id: string, questionId: string, answer: string): Promise<Application> {
	return serialized(async () => {
		const current = await getApplication(id);
		const questions = current.questions.map((question) =>
			question.id === questionId ? { ...question, answer, answeredAt: now(), deliveredAt: undefined } : question,
		);
		return persist({ ...current, questions }, current.status);
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

export function answerInboxQuestion(questionId: string, answer: string): Promise<Question[]> {
	return serialized(async () =>
		saveInbox(
			(await listInbox()).map((question) =>
				question.id === questionId ? { ...question, answer, answeredAt: now(), deliveredAt: undefined } : question,
			),
		),
	);
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
			answers.push({ ...origin, question: question.question, answer: question.answer ?? "" });
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
