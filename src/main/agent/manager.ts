import { randomUUID } from "node:crypto";
import path from "node:path";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ActivityItem, AgentState } from "@shared/ipc";
import { jobLinks } from "@shared/links";
import { app } from "electron";
import { runFinished, runStarted, track } from "../analytics";
import { hasUndeliveredAnswers, listApplications, startReassessment } from "../applications";
import { claudeEnvironment } from "../claude";
import { connectionModel } from "../connection";
import { broadcast } from "../events";
import { readJson, writeJson } from "../files";
import { cancelHelp } from "../help";
import { BROWSER_INPUT_TOOLS, BROWSER_SERVER, browserServer, bundledClaudeBinary, testOrigin } from "../runtime";
import { getSettings, updateSettings } from "../settings";
import { deskServer } from "../tools/desk";
import { dprozServer } from "../tools/dproz";
import { ensureWorkspace } from "../workspace";
import { changedLines } from "./changes";
import { describeTool } from "./describeTool";
import { RunMeter } from "./meter";
import {
	addJobPrompt,
	answersPrompt,
	documentsPrompt,
	linksPrompt,
	onboardingPrompt,
	profileEditedPrompt,
	reassessPrompt,
	subagents,
	submitPrompt,
	sweepPrompt,
	systemPrompt,
} from "./prompt";

type RunKind =
	| "onboard"
	| "sweep"
	| "answers"
	| "documents"
	| "links"
	| "add_job"
	| "submit"
	| "profile_edit"
	| "reassess";

type RunRequest = {
	kind: RunKind;
	label: string;
	prompt: string;
	key?: string;
	submitAllowed?: boolean;
	/** Checked as the run starts, after any wait in the queue: a run it refuses is skipped. */
	start?: () => Promise<unknown>;
	/** What the user said changed, for a reassessment. */
	note?: string;
};

const REASSESS = "reassess:";

type Persisted = { lastSweepAt?: string };

type Delegation = { applicationId?: string; step: string };

const ACTIVITY_LIMIT = 400;
const ANSWER_SETTLE_MS = 6000;
// Longer than for answers: someone who has saved one edit is often about to make another.
const EDIT_SETTLE_MS = 20_000;

const COORDINATOR = "coordinator";
const UNUSED_TOOLS = [
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"EnterWorktree",
	"ExitWorktree",
	"NotebookEdit",
	"CronCreate",
	"CronDelete",
	"CronList",
];

const stateFile = () => path.join(app.getPath("userData"), "agent.json");
const activityFile = () => path.join(app.getPath("userData"), "activity.json");
const stamp = () => new Date().toISOString();

function applicationIdIn(tool: string, input: Record<string, unknown>): string | undefined {
	const direct = tool.includes("__desk__") ? (input.applicationId ?? input.id) : undefined;
	if (typeof direct === "string") return direct;
	return /applications[\\/]+([a-z0-9-]+)/.exec(JSON.stringify(input))?.[1];
}

/** What a tool handed back, as text: a subagent's report arrives as text blocks. */
function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
		.join("\n");
}

const dprozReachable = (fence: string | undefined) => !fence || (process.env.DPROZ_API_URL ?? "").startsWith(fence);

class AgentManager {
	private status: AgentState["status"] = "idle";
	private runLabel: string | undefined;
	private current: RunRequest | null = null;
	private queue: RunRequest[] = [];
	private abort: AbortController | null = null;
	private activity: ActivityItem[] = [];
	private persisted: Persisted = {};
	private saveTimer: NodeJS.Timeout | null = null;
	private answersTimer: NodeJS.Timeout | null = null;
	private editedFrom: string | null = null;
	private editTimer: NodeJS.Timeout | null = null;
	private delegations = new Map<string, Delegation>();
	private meter = new RunMeter();
	private apiErrors: string[] = [];
	private paused = false;
	/** The user has the agent's browser open, and its profile cannot be open twice. */
	private held = false;
	private intervalHours = 6;

	async load() {
		this.persisted = await readJson<Persisted>(stateFile(), {});
		const saved = await readJson<ActivityItem[]>(activityFile(), []);
		this.activity = saved.map((item) =>
			item.kind === "tool" && item.state === "running" ? { ...item, state: "done" } : item,
		);
		await this.syncSettings();
		setInterval(() => void this.tick(), 30_000);
		setTimeout(() => void this.tick(), 3000);
	}

	state(): AgentState {
		const active: Record<string, string> = {};
		for (const { applicationId, step } of this.delegations.values()) if (applicationId) active[applicationId] = step;
		// A card being reassessed shows as worked on from the start, before a subagent picks it up.
		const reassessing = this.current?.key?.startsWith(REASSESS) ? this.current.key.slice(REASSESS.length) : undefined;
		if (reassessing && !active[reassessing]) active[reassessing] = "Reassessing";
		return {
			status: this.status,
			runLabel: this.runLabel,
			queued: this.queue.length,
			active,
			waiting: this.queue.flatMap(({ key }) => (key?.startsWith(REASSESS) ? [key.slice(REASSESS.length)] : [])),
			step: this.delegations.get(COORDINATOR)?.step,
			paused: this.paused,
			browserOpen: this.held,
			nextSweepAt: this.nextSweepAt(),
		};
	}

	recentActivity() {
		return this.activity;
	}

	onboard() {
		track("setup completed");
		this.enqueue({ kind: "onboard", label: "Reading your documents", key: "onboard", prompt: onboardingPrompt });
	}

	documentsAdded(names: string[]) {
		if (names.length) {
			this.enqueue({ kind: "documents", label: "Reading your documents", prompt: documentsPrompt(names) });
		}
	}

	linksAdded(urls: string[]) {
		if (urls.length) this.enqueue({ kind: "links", label: "Reading your links", prompt: linksPrompt(urls) });
	}

	addJob(source: string, prepareOnly: boolean) {
		const links = jobLinks(source);
		track("job added", { links: links.length, pasted_text: links.length === 0, prepare_only: prepareOnly });
		this.enqueue({
			kind: "add_job",
			label: links.length > 1 ? "Working on the jobs you added" : "Working on the job you added",
			prompt: addJobPrompt(source, prepareOnly),
		});
	}

	submit(applicationId: string) {
		this.enqueue({
			kind: "submit",
			label: "Sending an application",
			key: `submit:${applicationId}`,
			prompt: submitPrompt(applicationId),
			submitAllowed: true,
		});
	}

	/**
	 * The user asked the agent to look at one card again, perhaps saying what changed. Asking again
	 * before it starts replaces the note, unless the new request says nothing.
	 */
	reassess(applicationId: string, note?: string) {
		const key = `${REASSESS}${applicationId}`;
		if (this.current?.key === key) return;
		const said = note?.trim() || this.queue.find((queued) => queued.key === key)?.note;
		this.queue = this.queue.filter((queued) => queued.key !== key);
		this.enqueue({
			kind: "reassess",
			label: "Reassessing a job",
			key,
			note: said,
			prompt: reassessPrompt(applicationId, said),
			start: () => startReassessment(applicationId, said),
		});
	}

	/**
	 * The user edited their master resume. The edits of one sitting are gathered, and if the board has
	 * cards the agent checks whether any of them relied on what changed.
	 */
	profileEdited(before: string, after: string) {
		this.editedFrom ??= before;
		const from = this.editedFrom;
		if (this.editTimer) clearTimeout(this.editTimer);
		this.editTimer = setTimeout(async () => {
			this.editedFrom = null;
			const change = changedLines(from, after);
			if (!change.removed.length && !change.added.length) return;
			if ((await listApplications()).length === 0) return;
			this.enqueue({
				kind: "profile_edit",
				label: "Using your changes",
				prompt: profileEditedPrompt(change.removed, change.added),
			});
		}, EDIT_SETTLE_MS);
	}

	answersArrived() {
		if (this.answersTimer) clearTimeout(this.answersTimer);
		this.answersTimer = setTimeout(async () => {
			if (this.status !== "idle" || this.paused || this.held || !(await hasUndeliveredAnswers())) return;
			this.enqueue({ kind: "answers", label: "Using your answers", key: "answers", prompt: answersPrompt });
		}, ANSWER_SETTLE_MS);
	}

	async setPaused(paused: boolean) {
		await updateSettings({ paused });
		this.paused = paused;
		if (paused) this.stop();
		this.publishState();
		if (paused || this.status !== "idle") return;
		const waiting = this.queue.shift();
		if (waiting) void this.run(waiting);
		else void this.tick();
	}

	/** Hold all work while the user has the agent's browser. False when a run is using the browser now. */
	holdForBrowser() {
		if (this.status !== "idle") return false;
		this.held = true;
		this.publishState();
		return true;
	}

	releaseBrowser() {
		this.held = false;
		this.publishState();
		if (this.paused || this.status !== "idle") return;
		const waiting = this.queue.shift();
		if (waiting) void this.run(waiting);
		else void this.tick();
	}

	async syncSettings() {
		const settings = await getSettings();
		this.paused = settings.paused;
		this.intervalHours = settings.sweepIntervalHours;
		this.publishState();
	}

	stop() {
		if (!this.abort) return;
		this.status = "stopping";
		this.publishState();
		this.abort.abort();
	}

	private nextSweepAt() {
		if (this.paused || !this.persisted.lastSweepAt) return undefined;
		return new Date(Date.parse(this.persisted.lastSweepAt) + this.intervalHours * 3_600_000).toISOString();
	}

	private async tick() {
		const settings = await getSettings();
		if (!settings.onboarded || this.paused || this.held) return;
		if (this.status !== "idle" || this.queue.length > 0) return;
		if (await hasUndeliveredAnswers()) return this.answersArrived();
		const next = this.nextSweepAt();
		if (next && Date.parse(next) > Date.now()) return;
		this.enqueue({
			kind: "sweep",
			label: "Looking for jobs",
			key: "sweep",
			prompt: sweepPrompt(this.persisted.lastSweepAt),
		});
	}

	private enqueue(request: RunRequest) {
		if (request.key && this.queue.some((queued) => queued.key === request.key)) return;
		if (this.status === "idle" && !this.paused && !this.held) void this.run(request);
		else {
			this.queue.push(request);
			this.publishState();
		}
	}

	private async run(request: RunRequest): Promise<void> {
		// Running from here, so nothing else starts while the request is checked.
		this.status = "running";
		this.current = request;
		this.abort = new AbortController();
		if (request.start) {
			const refused = await request.start().then(
				() => undefined,
				(error: Error) => error.message,
			);
			// Refused, or paused while it was being checked: either way nothing runs now.
			if (refused || this.abort.signal.aborted) {
				this.abort = null;
				this.status = "idle";
				this.current = null;
				if (refused) this.notice("info", refused);
				// Checked and noted already, so it waits for the resume as it is.
				else this.queue.unshift({ ...request, start: undefined });
				return this.next();
			}
		}
		this.runLabel = request.label;
		this.publishState();
		this.notice("info", `${request.label}.`);
		const startedAt = stamp();
		let finished = false;
		let ending: string | undefined;
		let failure: string | undefined;
		let result: Extract<SDKMessage, { type: "result" }> | undefined;
		this.meter = new RunMeter();
		this.apiErrors = [];
		runStarted(request.kind);

		try {
			const settings = await getSettings();
			const workspace = await ensureWorkspace();
			const submitAllowed = request.submitAllowed ?? settings.autoSubmit;
			const fenced = testOrigin();
			const stream = query({
				prompt: request.prompt,
				options: {
					cwd: workspace.root,
					systemPrompt: systemPrompt({ submitAllowed, testOrigin: fenced }),
					settingSources: [],
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
					mcpServers: {
						desk: deskServer(),
						...(dprozReachable(fenced) ? { dproz: dprozServer() } : {}),
						[BROWSER_SERVER]: browserServer(workspace.root),
					},
					agents: subagents,
					disallowedTools: [
						...UNUSED_TOOLS,
						...(submitAllowed ? [] : BROWSER_INPUT_TOOLS),
						...(fenced ? ["WebFetch", "WebSearch"] : []),
					],
					model: connectionModel() ?? (settings.model || undefined),
					abortController: this.abort,
					env: claudeEnvironment(),
					pathToClaudeCodeExecutable: bundledClaudeBinary(),
				},
			});
			for await (const message of stream) {
				if (message.type === "result") {
					finished = message.subtype === "success";
					ending = message.subtype;
					result = message;
				}
				this.handle(message);
			}
			const minutes = Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60_000));
			if (finished) this.notice("success", `Finished in about ${minutes} min.`);
			else if (ending) this.notice("error", `Run ended early (${ending.replaceAll("_", " ")}).`);
		} catch (error) {
			if (this.abort?.signal.aborted) {
				ending = "stopped";
				this.notice("info", "Stopped.");
			} else {
				ending = "failed";
				failure = (error as Error).message;
				this.notice("error", failure);
			}
		} finally {
			cancelHelp();
			this.settleRunningTools();
		}

		void runFinished({
			kind: request.kind,
			outcome: ending ?? "ended",
			durationMs: Date.now() - Date.parse(startedAt),
			error: failure ?? (result?.subtype === "success" ? undefined : result?.errors?.[0]),
			apiErrors: this.apiErrors,
			costUsd: result?.total_cost_usd,
			turns: result?.num_turns,
			modelUsage: result?.modelUsage,
			report: this.meter.settle(result?.total_cost_usd),
		});
		if (request.key === "sweep" && finished) this.persisted.lastSweepAt = startedAt;
		this.abort = null;
		this.current = null;
		this.status = "idle";
		this.runLabel = undefined;
		this.delegations.clear();
		void writeJson(stateFile(), this.persisted);
		this.next();
	}

	private next() {
		const next = this.paused || this.held ? undefined : this.queue.shift();
		this.publishState();
		if (next) void this.run(next);
		else void this.tick();
	}

	private handle(message: SDKMessage) {
		if (message.type === "assistant") {
			const parent = message.parent_tool_use_id;
			this.meter.spend(parent, message.message.id, message.message.usage);
			if (message.error) {
				this.apiErrors.push(message.error);
				this.notice("error", `Claude reported: ${message.error.replaceAll("_", " ")}`);
			}
			const reportedBack = parent !== null && !message.message.content.some((block) => block.type === "tool_use");
			if (reportedBack) this.meter.note(parent, resultText(message.message.content));
			if (reportedBack && this.delegations.delete(parent)) this.publishState();
			for (const block of message.message.content) {
				if (block.type === "text" && block.text.trim() && parent === null) {
					this.record({ id: randomUUID(), at: stamp(), kind: "assistant", text: block.text, subagent: false });
				}
				if (block.type !== "tool_use") continue;
				const input = block.input as Record<string, unknown>;
				const step = describeTool(block.name, input);
				if (parent !== null) {
					this.follow(parent, block.name, input, step);
					continue;
				}
				const delegated = block.name === "Agent" || block.name === "Task";
				if (delegated) {
					const applicationId = applicationIdIn(block.name, input);
					this.delegations.set(block.id, { applicationId, step });
					this.meter.begin(block.id, input.subagent_type, applicationId);
				} else this.follow(COORDINATOR, block.name, input, step);
				this.record({
					id: block.id,
					at: stamp(),
					kind: "tool",
					tool: block.name,
					summary: step,
					state: "running",
					subagent: false,
				});
			}
			return;
		}
		if (message.type === "user" && Array.isArray(message.message.content)) {
			if (message.parent_tool_use_id !== null) return;
			for (const block of message.message.content) {
				if (block.type !== "tool_result") continue;
				if (this.delegations.delete(block.tool_use_id)) this.publishState();
				// A subagent in the background returns a placeholder here and reports later, in a notification.
				const returned = (message.tool_use_result as { status?: string } | undefined)?.status === "completed";
				if (block.is_error) this.meter.end(block.tool_use_id, "failed");
				else if (returned) this.meter.end(block.tool_use_id, "completed", resultText(block.content));
				else this.meter.note(block.tool_use_id, resultText(block.content));
				this.settleTool(block.tool_use_id, block.is_error ? "error" : "done");
			}
			return;
		}
		if (message.type === "system" && message.subtype === "task_notification" && message.tool_use_id) {
			this.meter.end(message.tool_use_id, message.status, message.summary);
		}
	}

	private follow(owner: string, tool: string, input: Record<string, unknown>, step: string) {
		const current = this.delegations.get(owner);
		const mentioned = applicationIdIn(tool, input);
		const leavingCard = owner === COORDINATOR && !mentioned && /search_jobs|list_applications|get_answers/.test(tool);
		this.delegations.set(owner, {
			applicationId: leavingCard ? undefined : (mentioned ?? current?.applicationId),
			step,
		});
		this.publishState();
		if (owner === COORDINATOR) return;
		const row = this.activity.find((entry) => entry.id === owner);
		if (row?.kind === "tool") this.record({ ...row, detail: step });
	}

	private settleTool(id: string, state: "done" | "error") {
		const item = this.activity.find((entry) => entry.id === id);
		if (item?.kind === "tool") this.record({ ...item, state, detail: undefined });
	}

	private settleRunningTools() {
		for (const item of this.activity) {
			if (item.kind === "tool" && item.state === "running") this.record({ ...item, state: "done", detail: undefined });
		}
	}

	private notice(tone: "info" | "success" | "error", text: string) {
		this.record({ id: randomUUID(), at: stamp(), kind: "notice", tone, text });
	}

	private record(item: ActivityItem) {
		const index = this.activity.findIndex((entry) => entry.id === item.id);
		if (index >= 0) this.activity[index] = item;
		else this.activity = [...this.activity, item].slice(-ACTIVITY_LIMIT);
		broadcast("agent:activity", item);
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void writeJson(activityFile(), this.activity), 800);
	}

	private publishState() {
		broadcast("agent:state", this.state());
	}
}

export const agent = new AgentManager();
