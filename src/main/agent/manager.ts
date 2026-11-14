import { randomUUID } from "node:crypto";
import path from "node:path";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ActivityItem, AgentState } from "@shared/ipc";
import { app } from "electron";
import { hasUndeliveredAnswers } from "../applications";
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
import { describeTool } from "./describeTool";
import {
	addJobPrompt,
	answersPrompt,
	correctionsPrompt,
	documentsPrompt,
	linksPrompt,
	onboardingPrompt,
	subagents,
	submitPrompt,
	sweepPrompt,
	systemPrompt,
} from "./prompt";

type RunRequest = { label: string; prompt: string; key?: string; submitAllowed?: boolean };

type Persisted = { lastSweepAt?: string };

type Delegation = { applicationId?: string; step: string };

const ACTIVITY_LIMIT = 400;
const ANSWER_SETTLE_MS = 6000;
// Longer than for answers: someone correcting one answer is often about to correct another.
const CORRECTION_SETTLE_MS = 20_000;
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

const dprozReachable = (fence: string | undefined) => !fence || (process.env.DPROZ_API_URL ?? "").startsWith(fence);

class AgentManager {
	private status: AgentState["status"] = "idle";
	private runLabel: string | undefined;
	private queue: RunRequest[] = [];
	private abort: AbortController | null = null;
	private activity: ActivityItem[] = [];
	private persisted: Persisted = {};
	private saveTimer: NodeJS.Timeout | null = null;
	private answersTimer: NodeJS.Timeout | null = null;
	private corrections: string[] = [];
	private correctionsTimer: NodeJS.Timeout | null = null;
	private delegations = new Map<string, Delegation>();
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
		return {
			status: this.status,
			runLabel: this.runLabel,
			queued: this.queue.length,
			active,
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
		this.enqueue({ label: "Reading your documents", key: "onboard", prompt: onboardingPrompt });
	}

	documentsAdded(names: string[]) {
		if (names.length) this.enqueue({ label: "Reading your documents", prompt: documentsPrompt(names) });
	}

	linksAdded(urls: string[]) {
		if (urls.length) this.enqueue({ label: "Reading your links", prompt: linksPrompt(urls) });
	}

	addJob(source: string, prepareOnly: boolean) {
		this.enqueue({ label: "Working on the job you added", prompt: addJobPrompt(source, prepareOnly) });
	}

	submit(applicationId: string) {
		this.enqueue({
			label: "Sending an application",
			key: `submit:${applicationId}`,
			prompt: submitPrompt(applicationId),
			submitAllowed: true,
		});
	}

	/**
	 * The user corrected or withdrew something they had told the agent. The corrections of one sitting
	 * are gathered and handled in one run.
	 */
	factsCorrected(change: string) {
		this.corrections.push(change);
		if (this.correctionsTimer) clearTimeout(this.correctionsTimer);
		this.correctionsTimer = setTimeout(() => {
			const changes = this.corrections.splice(0);
			if (changes.length) this.enqueue({ label: "Using your corrections", prompt: correctionsPrompt(changes) });
		}, CORRECTION_SETTLE_MS);
	}

	answersArrived() {
		if (this.answersTimer) clearTimeout(this.answersTimer);
		this.answersTimer = setTimeout(async () => {
			if (this.status !== "idle" || this.paused || this.held || !(await hasUndeliveredAnswers())) return;
			this.enqueue({ label: "Using your answers", key: "answers", prompt: answersPrompt });
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
		this.enqueue({ label: "Looking for jobs", key: "sweep", prompt: sweepPrompt(this.persisted.lastSweepAt) });
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
		this.status = "running";
		this.runLabel = request.label;
		this.abort = new AbortController();
		this.publishState();
		this.notice("info", `${request.label}.`);
		const startedAt = stamp();
		let finished = false;
		let ending: string | undefined;

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
				}
				this.handle(message);
			}
			const minutes = Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60_000));
			if (finished) this.notice("success", `Finished in about ${minutes} min.`);
			else if (ending) this.notice("error", `Run ended early (${ending.replaceAll("_", " ")}).`);
		} catch (error) {
			if (this.abort?.signal.aborted) this.notice("info", "Stopped.");
			else this.notice("error", (error as Error).message);
		} finally {
			cancelHelp();
			this.settleRunningTools();
		}

		if (request.key === "sweep" && finished) this.persisted.lastSweepAt = startedAt;
		this.abort = null;
		this.status = "idle";
		this.runLabel = undefined;
		this.delegations.clear();
		void writeJson(stateFile(), this.persisted);
		const next = this.paused || this.held ? undefined : this.queue.shift();
		this.publishState();
		if (next) void this.run(next);
		else void this.tick();
	}

	private handle(message: SDKMessage) {
		if (message.type === "assistant") {
			const parent = message.parent_tool_use_id;
			if (message.error) this.notice("error", `Claude reported: ${message.error.replaceAll("_", " ")}`);
			const reportedBack = parent !== null && !message.message.content.some((block) => block.type === "tool_use");
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
				if (delegated) this.delegations.set(block.id, { applicationId: applicationIdIn(block.name, input), step });
				else this.follow(COORDINATOR, block.name, input, step);
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
				this.settleTool(block.tool_use_id, block.is_error ? "error" : "done");
			}
			return;
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
