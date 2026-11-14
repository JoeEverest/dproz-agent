import { awaitingChoice, HAVE_IT, haveDetail, type QuestionReply } from "@shared/application";
import { Textarea } from "@ui-sdk/react/textarea";
import { ArrowUp, Bot, Briefcase, CheckCheck, ChevronLeft, ChevronRight, CornerDownRight } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useAgentState } from "../lib/agent";
import { relativeTime } from "../lib/format";
import type { OpenQuestion } from "../lib/questions";
import { HaveChoice } from "./HaveChoice";
import { PageHeader } from "./PageHeader";
import { Chip, IconButton } from "./ui";

const sendKey = navigator.platform.startsWith("Mac") ? "⌘ Return" : "Ctrl Enter";

function Avatar() {
	return (
		<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
			<Bot size={15} strokeWidth={1.75} aria-hidden />
		</span>
	);
}

const ASKING = {
	experience: "Do you have this experience?",
	skills: "Do you have this skill?",
	education: "Do you have this education?",
	certifications: "Do you have this certification?",
	none: "Do you have this?",
};

/** What a question asks right now: the requirement, its follow-up once they have it, or the question itself. */
const followingUp = (question: OpenQuestion) => Boolean(question.item && question.have && question.followUp);
const promptOf = (question: OpenQuestion) =>
	followingUp(question) ? (question.followUp ?? question.question) : (question.item ?? question.question);

type AgentMessageProps = {
	question: OpenQuestion;
	/** Show the follow-up to a quick question in place of the question itself. */
	followUp?: boolean;
	replying: boolean;
	canPick: boolean;
	onPick: () => void;
};

function AgentMessage({ question, followUp, replying, canPick, onPick }: AgentMessageProps) {
	const quick = Boolean(question.item) && !followUp;
	return (
		<li className="flex items-start gap-2.5">
			<Avatar />
			<div className="min-w-0 max-w-[78%]">
				<p className="mb-1 flex items-baseline gap-2 text-xs">
					<span className="font-medium">Dproz Agent</span>
					<time dateTime={question.askedAt} className="text-ink-3 tabular-nums">
						{relativeTime(question.askedAt)}
					</time>
				</p>
				<div className="rounded-2xl rounded-tl-md bg-fill-hover px-3.5 py-2.5">
					{question.about && (
						<p className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-3">
							<Briefcase size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
							<span className="truncate">{question.about.label}</span>
						</p>
					)}
					{quick && <p className="mb-0.5 text-xs text-ink-3">{ASKING[question.category ?? "none"]}</p>}
					<p className={`selectable text-pretty ${quick ? "font-medium" : ""}`}>
						{followUp ? question.followUp : (question.item ?? question.question)}
					</p>
					{!followUp && question.why && <p className="selectable mt-1 text-xs text-ink-2">{question.why}</p>}
				</div>
				{!question.answer && canPick && (followUp || !followingUp(question)) && (
					<p className="mt-1 pl-1 text-xs">
						{replying ? (
							<span className="font-medium text-accent-ink">Answering this one below</span>
						) : (
							<button type="button" className="font-medium text-ink-3 hover:text-ink" onClick={onPick}>
								Answer this one
							</button>
						)}
					</p>
				)}
			</div>
		</li>
	);
}

function UserMessage({ question, text }: { question: OpenQuestion; text: string }) {
	return (
		<li className="flex flex-col items-end">
			<p className="selectable max-w-[78%] rounded-2xl rounded-tr-md bg-solid px-3.5 py-2.5 whitespace-pre-wrap text-on-solid">
				{text}
			</p>
			{question.answer && (
				<p className="mt-1 flex items-center gap-1 pr-1 text-xs text-ink-3">
					{question.deliveredAt && <CheckCheck size={12} strokeWidth={2} className="text-accent" aria-hidden />}
					{question.deliveredAt ? "Saved to what the agent knows" : "Sent"}
					{question.answeredAt && <span className="tabular-nums"> · {relativeTime(question.answeredAt)}</span>}
				</p>
			)}
		</li>
	);
}

/**
 * One question as the messages it has produced so far. A quick question reads as a short exchange:
 * the requirement, the one-click answer, then the follow-up and its answer.
 */
function exchange(question: OpenQuestion, props: Omit<AgentMessageProps, "question" | "followUp">) {
	const ask = <AgentMessage key={`q-${question.id}`} question={question} {...props} />;
	const reply = (key: string, text: string) => (
		<UserMessage key={`${key}-${question.id}`} question={question} text={text} />
	);
	if (!question.item || question.have === undefined) {
		return question.answer ? [ask, reply("a", question.answer)] : [ask];
	}
	if (!question.have) return [ask, reply("a", "Not yet")];
	const detail =
		haveDetail(question.answer ?? "") || (question.answer?.startsWith(HAVE_IT) ? "" : (question.answer ?? ""));
	const messages = [ask];
	if (!question.followUp) return [...messages, reply("a", "I have it")];
	messages.push(
		<UserMessage key={`c-${question.id}`} question={{ ...question, answer: undefined }} text="I have it" />,
		<AgentMessage key={`f-${question.id}`} question={question} followUp {...props} />,
	);
	if (question.answer) messages.push(reply("a", detail || "Skipped"));
	return messages;
}

function Working({ label }: { label: string }) {
	return (
		<li className="flex items-center gap-2.5" aria-live="polite">
			<Avatar />
			<p className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-fill-hover px-3.5 py-2.5 text-ink-2">
				<span className="flex gap-1" aria-hidden>
					<span className="live-dot size-1.5 rounded-full bg-ink-3" />
					<span className="live-dot size-1.5 rounded-full bg-ink-3 [animation-delay:0.2s]" />
					<span className="live-dot size-1.5 rounded-full bg-ink-3 [animation-delay:0.4s]" />
				</span>
				{label}
			</p>
		</li>
	);
}

type ComposerProps = {
	open: OpenQuestion[];
	target: OpenQuestion | undefined;
	onPick: (id: string) => void;
	onAnswer: (question: OpenQuestion, reply: QuestionReply) => Promise<void>;
};

function Composer({ open, target, onPick, onAnswer }: ComposerProps) {
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// A quick question is answered with a click, unless the user would rather say it in their own words.
	const [ownWords, setOwnWords] = useState<string | null>(null);
	const position = target ? open.indexOf(target) : 0;
	const choosing = Boolean(target && awaitingChoice(target) && ownWords !== target.id);
	const canSkip = Boolean(target && followingUp(target));

	const send = async (reply: QuestionReply) => {
		if (!target) return;
		setSaving(true);
		setError(null);
		try {
			await onAnswer(target, reply);
			setDraft("");
		} catch (cause) {
			setError(`That did not send: ${(cause as Error).message}`);
		} finally {
			setSaving(false);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (draft.trim()) void send(draft.trim());
	};

	const step = (by: number) => {
		onPick(open[(position + by + open.length) % open.length].id);
		setDraft("");
	};

	return (
		<form onSubmit={submit} className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5">
			<div className="rounded-2xl border border-line-strong bg-surface shadow-[0_1px_2px_rgb(18_19_22/4%)] transition-[border-color] duration-150 focus-within:border-accent">
				{target && (
					<div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3.5 text-xs">
						<CornerDownRight size={13} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
						<span className="shrink-0 text-ink-3">Replying to</span>
						<span className="min-w-0 flex-1 truncate font-medium text-ink-2">{promptOf(target)}</span>
						{open.length > 1 ? (
							<span className="flex shrink-0 items-center text-ink-3 tabular-nums">
								<IconButton label="Previous question" className="size-6" onClick={() => step(-1)}>
									<ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
								</IconButton>
								{position + 1} of {open.length}
								<IconButton label="Next question" className="size-6" onClick={() => step(1)}>
									<ChevronRight size={14} strokeWidth={1.75} aria-hidden />
								</IconButton>
							</span>
						) : (
							<span className="h-6" />
						)}
					</div>
				)}
				{target && choosing ? (
					<div className="px-3.5 pt-3 pb-3">
						<HaveChoice question={target} disabled={saving} onChoose={(have) => void send({ have })} />
						<p className="mt-2.5 flex items-center justify-between gap-3 text-xs">
							<span className={error ? "text-danger" : "text-ink-3"} role={error ? "alert" : undefined}>
								{error ?? "One click answers it. Your answer is saved, so it is asked once."}
							</span>
							<button
								type="button"
								className="shrink-0 font-medium text-ink-3 hover:text-ink"
								onClick={() => setOwnWords(target.id)}
							>
								Answer in my own words
							</button>
						</p>
					</div>
				) : (
					<>
						<Textarea
							key={target?.id ?? "none"}
							rows={2}
							autoResize
							disabled={!target}
							value={draft}
							onValueChange={(value) => setDraft(value)}
							submitShortcut="mod+enter"
							placeholder={target ? "Your answer" : "Nothing to answer right now"}
							aria-label={target ? promptOf(target) : "Your answer"}
							style={{ outline: "none" }}
							className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-normal text-ink placeholder:text-ink-4"
						/>
						<div className="flex items-center justify-between gap-3 pt-1 pr-2 pb-2 pl-3.5">
							<span className={`text-xs ${error ? "text-danger" : "text-ink-3"}`} role={error ? "alert" : undefined}>
								{error ?? (target ? `${sendKey} to send` : "The agent will ask here when it needs you")}
							</span>
							<span className="flex shrink-0 items-center gap-2">
								{canSkip && (
									<button
										type="button"
										disabled={saving}
										className="px-1.5 text-xs font-medium text-ink-3 hover:text-ink"
										onClick={() => void send("")}
									>
										Skip
									</button>
								)}
								<button
									type="submit"
									aria-label="Send answer"
									disabled={!target || !draft.trim() || saving}
									className="pressable flex size-8 shrink-0 items-center justify-center rounded-full bg-solid text-on-solid hover:bg-solid-hover disabled:bg-fill-press disabled:text-ink-4"
								>
									<ArrowUp size={16} strokeWidth={2} aria-hidden />
								</button>
							</span>
						</div>
					</>
				)}
			</div>
		</form>
	);
}

type Props = {
	history: OpenQuestion[];
	open: OpenQuestion[];
	onAnswer: (question: OpenQuestion, reply: QuestionReply) => Promise<void>;
};

export function QuestionsPage({ history, open: waiting, onAnswer }: Props) {
	const agent = useAgentState();
	const [targetId, setTargetId] = useState<string | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	// Quick questions come first, so the one-click answers are out of the way before anything needs typing.
	const open = [...waiting.filter(awaitingChoice), ...waiting.filter((question) => !awaitingChoice(question))];
	const target = open.find((question) => question.id === targetId) ?? open[0];
	const answer = async (question: OpenQuestion, reply: QuestionReply) => {
		await onAnswer(question, reply);
		// After a click, move on to the next quick question rather than this one's follow-up.
		if (typeof reply !== "string") setTargetId(null);
	};
	const usingAnswers = agent.status === "running" && agent.runLabel === "Using your answers";

	// biome-ignore lint/correctness/useExhaustiveDependencies: keep the newest message in view as the thread grows
	useEffect(() => {
		const element = scroller.current;
		if (element) element.scrollTop = element.scrollHeight;
	}, [history, usingAnswers]);

	return (
		<section id="agent-panel" aria-label="Questions" className="flex min-h-0 flex-1 flex-col">
			<PageHeader title="Questions">
				{open.length > 0 && (
					<Chip tone="attention">{open.length === 1 ? "1 waiting for you" : `${open.length} waiting for you`}</Chip>
				)}
			</PageHeader>

			<div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
				{history.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center px-6 text-center">
						<Avatar />
						<h2 className="mt-3 text-sm font-semibold">No questions yet</h2>
						<p className="mt-1 max-w-[44ch] text-ink-3">
							When the agent needs something only you know, it asks here. Your answers are saved to what it knows about
							you, so each one is asked once.
						</p>
					</div>
				) : (
					<ol className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pt-6 pb-4">
						<li className="pb-1 text-center text-xs text-ink-3">
							The agent asks here when it needs something only you know. Each answer is saved, so it is asked once.
						</li>
						{history.flatMap((question) =>
							exchange(question, {
								replying: question.id === target?.id,
								canPick: open.length > 1,
								onPick: () => setTargetId(question.id),
							}),
						)}
						{usingAnswers && <Working label="Carrying on with your answers" />}
					</ol>
				)}
			</div>

			<Composer open={open} target={target} onPick={setTargetId} onAnswer={answer} />
		</section>
	);
}
