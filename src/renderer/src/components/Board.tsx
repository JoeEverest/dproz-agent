import {
	APPLICATION_STATUSES,
	type Application,
	type ApplicationStatus,
	STATUS_LABELS,
	unansweredQuestions,
} from "@shared/application";
import type { AgentState } from "@shared/ipc";
import {
	Bot,
	CalendarCheck,
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleHelp,
	CircleSlash,
	Clock,
	Globe,
	ListChecks,
	LoaderCircle,
	type LucideIcon,
	Mail,
	Paperclip,
	Pause,
	Play,
} from "lucide-react";
import { type DragEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAgentState } from "../lib/agent";
import { deadline, hostOf, shortAge, whenNext } from "../lib/format";
import { useDeskEvent } from "../lib/hooks";
import { AddJob } from "./AddJob";
import { ApplicationDrawer } from "./ApplicationDrawer";
import { PageHeader } from "./PageHeader";
import { Button, Chip } from "./ui";

export const statusIcon: Record<ApplicationStatus, { icon: LucideIcon; color: string }> = {
	found: { icon: CircleDashed, color: "text-ink-3" },
	needs_input: { icon: CircleHelp, color: "text-attention-mark" },
	ready_to_submit: { icon: CircleDot, color: "text-accent" },
	manual: { icon: Mail, color: "text-violet" },
	applied: { icon: CircleCheck, color: "text-sent" },
	interview: { icon: CalendarCheck, color: "text-accent" },
	closed: { icon: CircleSlash, color: "text-ink-4" },
};

const columnHints: Record<ApplicationStatus, string> = {
	found: "Jobs the agent is weighing up.",
	needs_input: "Nothing is waiting on you.",
	ready_to_submit: "Prepared, waiting for you to send.",
	manual: "Email applications for you to send.",
	applied: "Sent, with a confirmation.",
	interview: "Drag a card here when you hear back.",
	closed: "Jobs the agent decided against.",
};

export const fitLabel = { strong: "Strong fit", good: "Good fit", stretch: "Stretch", poor: "Poor fit" };

const Spinner = ({ size = 12 }: { size?: number }) => (
	<LoaderCircle size={size} className="shrink-0 animate-spin [animation-duration:0.8s]" aria-hidden />
);

function sourceOf(application: Application) {
	if (application.source === "dproz") return "Dproz";
	return hostOf(application.jobUrl ?? application.applyUrl) || "Added by you";
}

type CardProps = { application: Application; liveStep?: string; onOpen: () => void };

function Card({ application, liveStep, onOpen }: CardProps) {
	const settled = ["closed", "applied", "interview"].includes(application.status);
	const due = settled ? null : deadline(application.closesAt);
	const open = unansweredQuestions(application.questions).length;
	const attached = application.documents.length;

	return (
		<li data-card={application.id} style={{ viewTransitionName: `card-${application.id}` }}>
			<button
				type="button"
				draggable
				onDragStart={(event) => {
					event.dataTransfer.setData("text/application-id", application.id);
					event.dataTransfer.effectAllowed = "move";
				}}
				onClick={onOpen}
				className={`pressable flat block w-full rounded-lg bg-surface px-3 pt-2.5 pb-2 text-left hover:shadow-lift ${
					liveStep ? "shadow-[0_0_0_1.5px_var(--accent)]" : "shadow-card"
				}`}
			>
				<span className="block leading-snug font-medium text-pretty">{application.title}</span>
				<span className="mt-0.5 block truncate text-xs text-ink-3">
					{application.company}
					{application.location ? ` · ${application.location}` : ""}
				</span>
				<span className="mt-2 flex flex-wrap gap-1">
					{liveStep && (
						<Chip tone="live" icon={<Spinner size={11} />}>
							{liveStep}
						</Chip>
					)}
					{open > 0 && <Chip tone="attention">{open === 1 ? "1 question for you" : `${open} questions for you`}</Chip>}
					{application.applyMethod === "email" && !settled && <Chip tone="attention">Send by email</Chip>}
					{application.hold && !settled && <Chip>Prepare only</Chip>}
					{due && <Chip tone={due.urgent ? "danger" : "neutral"}>{due.text}</Chip>}
					{application.fit && <Chip>{fitLabel[application.fit.verdict]}</Chip>}
				</span>
				<span className="mt-2.5 flex items-center gap-2.5 text-xs text-ink-3 tabular-nums">
					<span className="flex min-w-0 flex-1 items-center gap-1.5">
						<Globe size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
						<span className="truncate">{sourceOf(application)}</span>
					</span>
					{attached > 0 && (
						<span className="flex shrink-0 items-center gap-1">
							<Paperclip size={12} strokeWidth={1.75} aria-hidden />
							{attached}
							<span className="sr-only">{attached === 1 ? "document" : "documents"}</span>
						</span>
					)}
					<span className="shrink-0">{shortAge(application.updatedAt)}</span>
				</span>
			</button>
		</li>
	);
}

type ColumnProps = {
	status: ApplicationStatus;
	applications: Application[];
	live: Record<string, string>;
	onOpen: (id: string) => void;
	onMove: (id: string, status: ApplicationStatus) => void;
};

function Column({ status, applications, live, onOpen, onMove }: ColumnProps) {
	const [over, setOver] = useState(false);
	const { icon: Icon, color } = statusIcon[status];

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const id = event.dataTransfer.getData("text/application-id");
		if (id) onMove(id, status);
	};

	return (
		<section
			aria-label={`${STATUS_LABELS[status]}, ${applications.length}`}
			onDragOver={(event) => {
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
			}}
			onDrop={onDrop}
			className={`flex h-full w-[272px] shrink-0 flex-col rounded-xl transition-[background-color,box-shadow] duration-150 ${
				over ? "bg-accent-wash shadow-[inset_0_0_0_1.5px_var(--accent)]" : "bg-column"
			}`}
		>
			<header className="flex h-10 shrink-0 items-center gap-2 px-3">
				<Icon size={14} strokeWidth={2} className={`shrink-0 ${color}`} aria-hidden />
				<h2 className="truncate font-medium">{STATUS_LABELS[status]}</h2>
				<span className="text-xs text-ink-3 tabular-nums">{applications.length}</span>
			</header>
			{applications.length === 0 ? (
				<p className="px-3 text-xs text-ink-3">{columnHints[status]}</p>
			) : (
				<ul className="scroll-quiet flex min-h-0 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2">
					{applications.map((application) => (
						<Card
							key={application.id}
							application={application}
							liveStep={live[application.id]}
							onOpen={() => onOpen(application.id)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function Cell({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
	return (
		<div className="min-w-0 px-4 py-3">
			<p className="flex items-center gap-1.5 text-xs text-ink-3">
				<Icon size={13} strokeWidth={1.75} aria-hidden />
				{label}
			</p>
			{children}
		</div>
	);
}

const schedule: Record<number, string> = {
	4: "Every 4 hours",
	6: "Every 6 hours",
	12: "Twice a day",
	24: "Once a day",
};

type AgentPanelProps = { agent: AgentState; applications: Application[]; sweepIntervalHours: number };

function AgentPanel({ agent, applications, sweepIntervalHours }: AgentPanelProps) {
	const running = agent.status !== "idle";
	const tasks = Object.entries(agent.active).map(([id, step]) => {
		const card = applications.find((application) => application.id === id);
		return { id, step, name: card ? `${card.title} at ${card.company}` : "A new job" };
	});
	const shown = tasks.slice(0, 3);
	const state = running ? "Working" : agent.paused ? "Paused" : "Idle";
	const stateNote = running
		? (agent.runLabel ?? "Working")
		: agent.paused
			? "Nothing runs until you resume it"
			: "Waiting for the next search";

	return (
		<section
			aria-label="What the agent is doing"
			className="mx-6 mt-4 grid shrink-0 grid-cols-[220px_minmax(0,1fr)_200px] divide-x divide-line rounded-xl border border-line"
		>
			<Cell icon={Bot} label="Agent">
				<div className="mt-1 flex items-center gap-2">
					<span
						className={`size-2 shrink-0 rounded-full ${
							running ? "live-dot bg-accent" : agent.paused ? "bg-attention-mark" : "bg-sent"
						}`}
					/>
					<p className="text-sm font-semibold">{state}</p>
					<Button
						size="sm"
						className="-my-1 ml-auto"
						icon={
							agent.paused ? (
								<Play size={12} strokeWidth={2} aria-hidden />
							) : (
								<Pause size={12} strokeWidth={2} aria-hidden />
							)
						}
						onClick={() => void window.desk.agent.setPaused(!agent.paused)}
					>
						{agent.paused ? "Resume" : "Pause"}
					</Button>
				</div>
				<p className="mt-0.5 truncate text-xs text-ink-3">{stateNote}</p>
			</Cell>

			<Cell icon={ListChecks} label="Working on now">
				<div aria-live="polite">
					{!running && <p className="mt-1 text-ink-3">Nothing right now.</p>}
					{running && shown.length === 0 && (
						<p className="mt-1 flex items-center gap-2 text-accent-ink">
							<Spinner />
							<span className="truncate font-medium">{agent.step ?? agent.runLabel ?? "Starting"}</span>
						</p>
					)}
					{running && shown.length > 0 && (
						<ul className="mt-1 flex flex-col gap-0.5">
							{shown.map((task) => (
								<li key={task.id} className="flex items-center gap-2">
									<span className="text-accent">
										<Spinner />
									</span>
									<span className="max-w-[62%] min-w-0 shrink-0 truncate font-medium">{task.name}</span>
									<span className="truncate text-xs text-ink-3">{task.step}</span>
								</li>
							))}
							{tasks.length > shown.length && (
								<li className="pl-5 text-xs text-ink-3">and {tasks.length - shown.length} more, marked on the board</li>
							)}
						</ul>
					)}
				</div>
			</Cell>

			<Cell icon={Clock} label="Next search">
				<p className="mt-1 text-sm font-semibold tabular-nums">
					{agent.paused
						? "Paused"
						: agent.runLabel === "Looking for jobs"
							? "Running now"
							: agent.nextSweepAt
								? whenNext(agent.nextSweepAt)
								: "Soon"}
				</p>
				<p className="mt-0.5 truncate text-xs text-ink-3">{schedule[sweepIntervalHours] ?? "On a timer"}</p>
			</Cell>
		</section>
	);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const placement = (applications: Application[]) => applications.map(({ id, status }) => `${id}:${status}`).join("|");

function useApplications() {
	const [applications, setApplications] = useState<Application[] | null>(null);
	const shown = useRef("");

	const refresh = useCallback(async () => {
		const next = await window.desk.applications.list();
		const previous = new Map(shown.current.split("|").map((entry) => entry.split(":") as [string, string]));
		const movedCard = next.find(
			(application) => previous.has(application.id) && previous.get(application.id) !== application.status,
		);
		const reveal = () =>
			movedCard &&
			document.querySelector(`[data-card="${movedCard.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
		const moved = shown.current !== "" && placement(next) !== shown.current;
		shown.current = placement(next);
		if (moved && document.startViewTransition && !reducedMotion()) {
			document.startViewTransition(() => {
				flushSync(() => setApplications(next));
				reveal();
			});
		} else {
			setApplications(next);
			requestAnimationFrame(() => reveal());
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);
	useDeskEvent("applications:changed", () => void refresh());

	return { applications, refresh };
}

export function Board({
	showReadyColumn,
	sweepIntervalHours,
}: {
	showReadyColumn: boolean;
	sweepIntervalHours: number;
}) {
	const { applications, refresh } = useApplications();
	const agent = useAgentState();
	const [openId, setOpenId] = useState<string | null>(null);
	const all = applications ?? [];
	const live = agent.status === "running" ? agent.active : {};
	const inColumn = (status: ApplicationStatus) => all.filter((application) => application.status === status);
	const columns = APPLICATION_STATUSES.filter(
		(status) => status !== "ready_to_submit" || showReadyColumn || inColumn(status).length > 0,
	);

	const move = async (id: string, status: ApplicationStatus) => {
		const current = all.find((application) => application.id === id);
		if (!current || current.status === status) return;
		await window.desk.applications.setStatus(id, status);
		await refresh();
	};

	return (
		<>
			<PageHeader title="Jobs">
				<AddJob />
			</PageHeader>
			<AgentPanel agent={agent} applications={all} sweepIntervalHours={sweepIntervalHours} />
			{applications && all.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
					<h2 className="text-sm font-semibold">No jobs yet</h2>
					<p className="mt-1 max-w-[46ch] text-ink-3">
						Every job the agent considers lands here, from first sighting to interview. Found one yourself? Use Add a
						job.
					</p>
				</div>
			) : (
				<div className="scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pt-4 pb-5">
					{columns.map((status) => (
						<Column
							key={status}
							status={status}
							applications={inColumn(status)}
							live={live}
							onOpen={setOpenId}
							onMove={(id, target) => void move(id, target)}
						/>
					))}
				</div>
			)}
			<ApplicationDrawer
				application={all.find((application) => application.id === openId) ?? null}
				liveStep={openId ? live[openId] : undefined}
				onClose={() => setOpenId(null)}
				onChanged={refresh}
			/>
		</>
	);
}
