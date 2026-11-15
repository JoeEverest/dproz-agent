/**
 * Anonymous usage analytics, sent to PostHog: which models are used and what runs cost, how far each
 * application gets and where it stops, and what an application costs by how it is sent.
 *
 * What is sent is counts, timings, costs, model names, statuses and the hostname of the site an
 * application goes through. Nothing that says who the user is or what a job is: no names, no
 * documents, no answers, no job titles or employers. A card is identified by a hash. The user can
 * turn it off in Settings, and a build without a key sends nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { Application, ApplicationStatus, Question } from "@shared/application";
import { app } from "electron";
import { outcomeFromCard, type RunReport } from "./agent/meter";
import { listApplications, onStatusChange } from "./applications";
import { connectionStatus } from "./connection";
import { readJson, writeJson } from "./files";
import { getSettings } from "./settings";

declare const __POSTHOG_KEY__: string | undefined;

const projectKey = () =>
	process.env.DPROZ_AGENT_POSTHOG_KEY ?? (typeof __POSTHOG_KEY__ === "string" ? __POSTHOG_KEY__ : "");
const host = () => process.env.DPROZ_AGENT_POSTHOG_HOST || "https://us.i.posthog.com";

const FLUSH_MS = 15_000;
const QUEUE_LIMIT = 500;

/** What each card has cost so far, kept on this computer so a total can be reported when it is sent. */
type CardTotals = { costUsd: number; steps: number; revisions: number; runs: number; addedByUser?: boolean };
type Stored = { id: string; cards: Record<string, CardTotals> };
type Event = { event: string; properties: Record<string, unknown>; timestamp: string };

const stateFile = () => path.join(app.getPath("userData"), "analytics.json");

let state: Stored = { id: "", cards: {} };
let queue: Event[] = [];
let sending = false;
/** The kind of run in progress, or null between runs. */
let runKind: string | null = null;
const reached = new Set<string>();
const userMoves = new Set<string>();

/**
 * Only an installed copy reports, so development and test runs stay out of the figures. A test that
 * wants to see what is sent names its own host.
 */
async function enabled() {
	if (!projectKey() || !(app.isPackaged || process.env.DPROZ_AGENT_POSTHOG_HOST)) return false;
	return (await getSettings()).shareUsage;
}

const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

export function track(event: string, properties: Record<string, unknown> = {}) {
	queue.push({ event, properties, timestamp: new Date().toISOString() });
	if (queue.length > QUEUE_LIMIT) queue = queue.slice(-QUEUE_LIMIT);
}

async function common() {
	const settings = await getSettings();
	const connection = connectionStatus();
	return {
		distinct_id: state.id,
		$lib: "dproz-agent",
		// Events only: no person profile is built from them.
		$process_person_profile: false,
		app_version: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		connection: connection.kind,
		model: connection.kind === "custom" ? connection.model : settings.model || "default",
		auto_submit: settings.autoSubmit,
	};
}

export async function flushAnalytics() {
	if (sending || queue.length === 0) return;
	if (!(await enabled())) {
		queue = [];
		return;
	}
	sending = true;
	const batch = queue;
	queue = [];
	try {
		const shared = await common();
		const response = await fetch(`${host()}/batch/`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				api_key: projectKey(),
				batch: batch.map((item) => ({ ...item, properties: { ...shared, ...item.properties } })),
			}),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`PostHog answered ${response.status}`);
	} catch {
		// Offline or refused: try again with the next batch, without growing forever.
		queue = [...batch, ...queue].slice(-QUEUE_LIMIT);
	} finally {
		sending = false;
	}
}

function totals(id: string) {
	state.cards[id] ??= { costUsd: 0, steps: 0, revisions: 0, runs: 0 };
	return state.cards[id];
}

function hostOf(url: string | undefined) {
	try {
		return url ? new URL(url).hostname : undefined;
	} catch {
		return undefined;
	}
}

/** Why a card was closed, as a kind. The reason itself is about the user and the job, so it stays here. */
function closedKind(reason: string | undefined) {
	if (!reason) return "none";
	if (/deadline|expired|no longer|closed|filled|taken down|not accepting/i.test(reason)) return "posting_closed";
	if (/lack|require|degree|qualif|experience|years|certif|licen[cs]e|not eligible|citizen/i.test(reason))
		return "requirement_gap";
	if (/duplicate|already/i.test(reason)) return "duplicate";
	return "other";
}

function cardProperties(application: Application) {
	return {
		// Stable for one card on one computer, and says nothing about the job.
		application: createHash("sha256").update(`${state.id}:${application.id}`).digest("hex").slice(0, 16),
		// The agent names the source in its own words, which can name an employer. Only job boards are kept.
		source: /dproz|linkedin|indeed/i.exec(application.source)?.[0].toLowerCase() ?? "other",
		apply_method: application.applyMethod,
		apply_host: hostOf(application.applyUrl ?? application.jobUrl),
		fit: application.fit?.verdict,
		prepare_only: Boolean(application.hold),
		added_by_user: Boolean(state.cards[application.id]?.addedByUser),
	};
}

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** The summary for an application that is as far as the agent takes it: sent, or ready to email. */
function completed(application: Application) {
	const sum = totals(application.id);
	track("application completed", {
		...cardProperties(application),
		outcome: application.status,
		cost_usd: round(sum.costUsd),
		steps: sum.steps,
		revisions: sum.revisions,
		runs: sum.runs,
		questions: application.questions.length,
		minutes_since_found: minutesSince(application.createdAt),
	});
}

const STATUS_EVENT: Record<ApplicationStatus, string> = {
	found: "application found",
	needs_input: "application needs input",
	ready_to_submit: "application ready",
	manual: "application manual",
	applied: "application applied",
	interview: "application interview",
	closed: "application closed",
};

function statusChanged(application: Application, previous: ApplicationStatus | null) {
	const byUser = userMoves.delete(application.id);
	if (previous === null && runKind === "add_job") totals(application.id).addedByUser = true;
	track(STATUS_EVENT[application.status], {
		...cardProperties(application),
		from: previous ?? "none",
		by: byUser ? "user" : "agent",
		minutes_since_found: minutesSince(application.createdAt),
		...(application.status === "closed" ? { closed_kind: closedKind(application.closedReason) } : {}),
	});
	if (application.status !== "applied" && application.status !== "manual") return;
	// During a run the cost of the step that got it here is not known yet, so the summary waits.
	if (runKind) reached.add(application.id);
	else completed(application);
}

type Asked = { item?: string; category?: string };

export function questionsAsked(questions: Asked[], scope: "application" | "general") {
	for (const question of questions) {
		track("question asked", { kind: question.item ? "quick" : "typed", scope, category: question.category });
	}
}

export function questionAnswered(question: Question | undefined) {
	if (!question?.answeredAt) return;
	track("question answered", {
		kind: question.item ? "quick" : "typed",
		have: question.have,
		category: question.category,
		minutes_to_answer: Math.max(
			0,
			Math.round((Date.parse(question.answeredAt) - Date.parse(question.askedAt)) / 60_000),
		),
	});
}

/** The agent handed the browser to the user. What it asked for is kept to a kind. */
export function helpRequested(instruction: string, outcome: string, waitedMs: number) {
	const kind = /captcha|robot|puzzle|human/i.test(instruction)
		? "captcha"
		: /code|otp|sms|verif|confirm/i.test(instruction)
			? "code"
			: /sign in|log ?in|password|account/i.test(instruction)
				? "sign_in"
				: "other";
	track("browser help requested", { kind, outcome, waited_s: Math.round(waitedMs / 1000) });
}

/** The next status change of this card is the user's doing, not the agent's. */
export function userMoved(id: string) {
	userMoves.add(id);
}

export function runStarted(kind: string) {
	runKind = kind;
}

/** A message with whatever could say who the user is taken out: their home folder and any email address. */
function plain(message: string) {
	return message
		.replaceAll(os.homedir(), "~")
		.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "<email>")
		.slice(0, 200);
}

export type RunSummary = {
	kind: string;
	/** success, stopped, failed, or how the SDK said the run ended. */
	outcome: string;
	durationMs: number;
	error?: string;
	apiErrors: string[];
	costUsd?: number;
	turns?: number;
	modelUsage?: Record<string, ModelUsage>;
	report: RunReport;
};

export async function runFinished(run: RunSummary) {
	const models = Object.entries(run.modelUsage ?? {});
	const sum = (field: (usage: ModelUsage) => number) => models.reduce((all, [, usage]) => all + field(usage), 0);
	track("run finished", {
		kind: run.kind,
		outcome: run.outcome,
		duration_s: Math.round(run.durationMs / 1000),
		cost_usd: run.costUsd === undefined ? undefined : round(run.costUsd),
		coordinator_cost_usd: run.report.coordinatorCostUsd === null ? undefined : round(run.report.coordinatorCostUsd),
		turns: run.turns,
		input_tokens: sum((usage) => usage.inputTokens),
		output_tokens: sum((usage) => usage.outputTokens),
		cache_read_tokens: sum((usage) => usage.cacheReadInputTokens),
		cache_write_tokens: sum((usage) => usage.cacheCreationInputTokens),
		models: models.map(([model]) => model),
		steps: run.report.steps.length,
		error: run.error ? plain(run.error) : undefined,
		api_errors: run.apiErrors.length ? [...new Set(run.apiErrors)] : undefined,
	});
	for (const [model, usage] of models) {
		track("model used", {
			used_model: model,
			run_kind: run.kind,
			cost_usd: round(usage.costUSD),
			input_tokens: usage.inputTokens,
			output_tokens: usage.outputTokens,
			cache_read_tokens: usage.cacheReadInputTokens,
			cache_write_tokens: usage.cacheCreationInputTokens,
		});
	}

	const cards = new Map((await listApplications().catch(() => [])).map((card) => [card.id, card]));
	const worked = new Set<string>();
	for (const step of run.report.steps) {
		const card = step.applicationId ? cards.get(step.applicationId) : undefined;
		const outcome = outcomeFromCard(step.step, step.outcome, card?.status);
		if (card) {
			const sumOf = totals(card.id);
			sumOf.costUsd += step.costUsd ?? 0;
			sumOf.steps += 1;
			if (step.step === "judge" && outcome === "REVISE") sumOf.revisions += 1;
			worked.add(card.id);
		}
		track("application step", {
			...(card ? cardProperties(card) : {}),
			run_kind: run.kind,
			step: step.step,
			outcome,
			duration_s: Math.round(step.durationMs / 1000),
			tokens: step.tokens,
			cost_usd: step.costUsd === null ? undefined : round(step.costUsd),
		});
	}
	for (const id of worked) totals(id).runs += 1;
	for (const id of reached) {
		const card = cards.get(id);
		if (card && (card.status === "applied" || card.status === "manual")) completed(card);
	}
	reached.clear();
	runKind = null;
	for (const id of Object.keys(state.cards)) if (!cards.has(id)) delete state.cards[id];
	await writeJson(stateFile(), state);
	await flushAnalytics();
}

export async function startAnalytics() {
	const saved = await readJson<Partial<Stored>>(stateFile(), {});
	state = { id: saved.id ?? randomUUID(), cards: saved.cards ?? {} };
	if (!saved.id) await writeJson(stateFile(), state);
	onStatusChange(statusChanged);

	const settings = await getSettings();
	const board = await listApplications().catch(() => []);
	const onBoard = (status: ApplicationStatus) => board.filter((card) => card.status === status).length;
	track("app opened", {
		onboarded: settings.onboarded,
		sweep_interval_hours: settings.sweepIntervalHours,
		cards: board.length,
		cards_applied: onBoard("applied"),
		cards_manual: onBoard("manual"),
		cards_needs_input: onBoard("needs_input"),
		cards_interview: onBoard("interview"),
	});
	setInterval(() => void flushAnalytics(), FLUSH_MS).unref();
	void flushAnalytics();
}
