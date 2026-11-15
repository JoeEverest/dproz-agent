/**
 * Measures one agent run: which subagent worked on which card, how it ended, and what share of the
 * run's cost it used. The SDK reports a cost for the whole run only, so each step's share is worked
 * out from the tokens its own messages used.
 */

export type TokenUsage = {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
	cache_read_input_tokens?: number | null;
};

export type StepName = "write" | "judge" | "send" | "other";

export type StepReport = {
	step: StepName;
	applicationId?: string;
	/** The first word of the subagent's report (READY, REVISE, APPLIED…), or ERROR, INTERRUPTED, UNKNOWN. */
	outcome: string;
	durationMs: number;
	tokens: number;
	/** Null when the run ended without reporting a cost. */
	costUsd: number | null;
};

export type RunReport = { steps: StepReport[]; coordinatorCostUsd: number | null; tokens: number };

const COORDINATOR = "coordinator";

const STEPS: Record<string, StepName> = {
	"application-writer": "write",
	"application-judge": "judge",
	"application-sender": "send",
};

const VERDICT = /\b(READY|NEEDS_INPUT|MANUAL|CLOSED|BLOCKED|SEND|REVISE|APPLIED|SENT|SUBMITTED)\b/;
// A sender sometimes says the same thing in another word.
const SAME: Record<string, string> = { SENT: "APPLIED", SUBMITTED: "APPLIED" };

/** The verdict a subagent ends its report with. It is asked for on the last line, so that is read first. */
export function reportOutcome(report: string): string {
	const lines = report
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.reverse();
	for (const line of lines) {
		const verdict = VERDICT.exec(line)?.[1];
		if (verdict) return SAME[verdict] ?? verdict;
	}
	return "UNKNOWN";
}

/**
 * How a step ended when its report gave no verdict, read from where it left the card. Only the endings
 * a card's status can tell apart: a writer that reported READY leaves the status as it was.
 */
export function outcomeFromCard(step: StepName, outcome: string, status: string | undefined): string {
	if (outcome !== "UNKNOWN" || !status) return outcome;
	const left: Record<string, string> = { needs_input: "NEEDS_INPUT", closed: "CLOSED" };
	if (step === "send") left.applied = "APPLIED";
	if (step === "write") left.manual = "MANUAL";
	return left[status] ?? outcome;
}

const count = (value: number | null | undefined) => value ?? 0;

/** Tokens weighed by what each kind costs relative to plain input, which holds across Claude models. */
const weight = (usage: TokenUsage) =>
	count(usage.input_tokens) +
	count(usage.cache_creation_input_tokens) * 1.25 +
	count(usage.cache_read_input_tokens) * 0.1 +
	count(usage.output_tokens) * 5;

const total = (usage: TokenUsage) =>
	count(usage.input_tokens) +
	count(usage.cache_creation_input_tokens) +
	count(usage.cache_read_input_tokens) +
	count(usage.output_tokens);

type Step = {
	step: StepName;
	applicationId?: string;
	startedAt: number;
	endedAt?: number;
	outcome?: string;
	/** The SDK said the step is over, however it ended. */
	done?: boolean;
};

export class RunMeter {
	private steps = new Map<string, Step>();
	// One entry per model response. A response arrives once per content block with the same usage, so it
	// is kept by id rather than added up.
	private spent = new Map<string, { owner: string; weight: number; tokens: number }>();

	constructor(private clock: () => number = Date.now) {}

	begin(id: string, agent: unknown, applicationId?: string) {
		const step = STEPS[String(agent)] ?? "other";
		this.steps.set(id, { step, applicationId, startedAt: this.clock() });
	}

	spend(parent: string | null, messageId: string, usage: TokenUsage | undefined) {
		if (!usage) return;
		this.spent.set(messageId, { owner: parent ?? COORDINATOR, weight: weight(usage), tokens: total(usage) });
	}

	/**
	 * Something that may carry a step's verdict: what the subagent itself said, or what the Agent tool
	 * handed back. A subagent that runs in the background hands back a placeholder at once, which has no
	 * verdict and changes nothing.
	 */
	note(id: string, text: string) {
		const step = this.steps.get(id);
		const verdict = reportOutcome(text);
		if (!step || verdict === "UNKNOWN") return;
		step.outcome = verdict;
		step.endedAt = this.clock();
	}

	/** The step is over. A step that failed or was stopped says so in place of a verdict. */
	end(id: string, how: "completed" | "failed" | "stopped", report = "") {
		const step = this.steps.get(id);
		if (!step) return;
		step.done = true;
		step.endedAt = this.clock();
		if (how === "failed") step.outcome = "ERROR";
		else if (how === "stopped") step.outcome = "INTERRUPTED";
		else this.note(id, report);
	}

	/** Splits the run's cost between the coordinator and each step, by the tokens each one used. */
	settle(totalCostUsd: number | undefined): RunReport {
		const byOwner = new Map<string, { weight: number; tokens: number }>();
		for (const { owner, weight: spent, tokens } of this.spent.values()) {
			const sum = byOwner.get(owner) ?? { weight: 0, tokens: 0 };
			byOwner.set(owner, { weight: sum.weight + spent, tokens: sum.tokens + tokens });
		}
		const whole = [...byOwner.values()].reduce((sum, owner) => sum + owner.weight, 0);
		const share = (owner: string) =>
			totalCostUsd === undefined || whole === 0 ? null : (totalCostUsd * (byOwner.get(owner)?.weight ?? 0)) / whole;

		const now = this.clock();
		const steps = [...this.steps.entries()].map(([id, step]) => ({
			step: step.step,
			applicationId: step.applicationId,
			outcome: step.outcome ?? (step.done ? "UNKNOWN" : "INTERRUPTED"),
			durationMs: (step.endedAt ?? now) - step.startedAt,
			tokens: byOwner.get(id)?.tokens ?? 0,
			costUsd: share(id),
		}));
		return {
			steps,
			coordinatorCostUsd: share(COORDINATOR),
			tokens: [...byOwner.values()].reduce((sum, owner) => sum + owner.tokens, 0),
		};
	}
}
