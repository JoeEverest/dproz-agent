import { attachedAnswer, awaitingChoice, type QuestionReply } from "@shared/application";
import { Textarea } from "@ui-sdk/react/textarea";
import {
	ArrowDown,
	ArrowUp,
	Bot,
	Briefcase,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	CornerDownRight,
	FileText,
	Paperclip,
	X,
} from "lucide-react";
import { type DragEvent, type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
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

const promptOf = (question: OpenQuestion) => question.item ?? question.question;

const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file;

/** The documents that go with an answer: waiting to be sent with it, or sent. */
function AttachedFiles({ names, onRemove }: { names: string[]; onRemove?: (index: number) => void }) {
	return (
		<ul aria-label="Attached documents" className="flex flex-wrap gap-1.5">
			{names.map((name, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: two attached files can share a name
					key={`${name}-${index}`}
					className={`flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface pl-2 text-xs text-ink-2 ${onRemove ? "pr-1" : "pr-2"}`}
				>
					<FileText size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
					<span className="truncate">{name}</span>
					{onRemove && (
						<IconButton label={`Remove ${name}`} className="size-5!" onClick={() => onRemove(index)}>
							<X size={12} strokeWidth={2} aria-hidden />
						</IconButton>
					)}
				</li>
			))}
		</ul>
	);
}

type AgentMessageProps = { question: OpenQuestion; replying: boolean; canPick: boolean; onPick: () => void };

function AgentMessage({ question, replying, canPick, onPick }: AgentMessageProps) {
	const quick = Boolean(question.item);
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
					<p className={`selectable text-pretty ${quick ? "font-medium" : ""}`}>{promptOf(question)}</p>
					{question.why && <p className="selectable mt-1 text-xs text-ink-2">{question.why}</p>}
				</div>
				{!question.answer && canPick && (
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

function UserMessage({ question }: { question: OpenQuestion }) {
	// A one-click answer reads as the button that was pressed.
	const text =
		question.item && question.have !== undefined ? (question.have ? "I have it" : "Not yet") : question.answer;
	const documents = question.documents ?? [];
	// An answer that is only documents reads as the documents.
	const onlyDocuments = documents.length > 0 && question.answer === attachedAnswer(documents);
	return (
		<li className="flex flex-col items-end">
			{!onlyDocuments && (
				<p className="selectable max-w-[78%] rounded-2xl rounded-tr-md bg-solid px-3.5 py-2.5 whitespace-pre-wrap text-on-solid">
					{text}
				</p>
			)}
			{documents.length > 0 && (
				<div className={`flex max-w-[78%] justify-end ${onlyDocuments ? "" : "mt-1.5"}`}>
					<AttachedFiles names={documents} />
				</div>
			)}
			<p className="mt-1 flex items-center gap-1 pr-1 text-xs text-ink-3">
				{question.deliveredAt && <CheckCheck size={12} strokeWidth={2} className="text-accent" aria-hidden />}
				{question.deliveredAt ? "Saved to what the agent knows" : "Sent"}
				{question.answeredAt && <span className="tabular-nums"> · {relativeTime(question.answeredAt)}</span>}
			</p>
		</li>
	);
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
	onAnswer: (question: OpenQuestion, reply: QuestionReply, files: string[]) => Promise<void>;
};

function Composer({ open, target, onPick, onAnswer }: ComposerProps) {
	// What has been typed stays with its question, so looking at another one loses nothing.
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const draft = target ? (drafts[target.id] ?? "") : "";
	// Files wait with the question they were attached for, and are added to the documents when it is answered.
	const [attachments, setAttachments] = useState<Record<string, string[]>>({});
	const files = target ? (attachments[target.id] ?? []) : [];
	const [over, setOver] = useState(false);
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
	const error = failed && failed.id === target?.id ? failed.message : null;
	const position = target ? open.indexOf(target) : 0;
	// A quick question is answered with a click, and only with a click.
	const choosing = Boolean(target && awaitingChoice(target));

	const send = async (reply: QuestionReply) => {
		if (!target || saving) return;
		setSaving(true);
		setFailed(null);
		try {
			await onAnswer(target, reply, files);
			setDrafts(({ [target.id]: _sent, ...rest }) => rest);
			setAttachments(({ [target.id]: _sent, ...rest }) => rest);
		} catch (cause) {
			const message = (cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
			setFailed({ id: target.id, message: `That did not send: ${message}` });
		} finally {
			setSaving(false);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (draft.trim() || files.length) void send(draft.trim());
	};

	const attach = (paths: string[]) => {
		if (!target || saving) return;
		const fresh = paths.filter((file) => file && !files.includes(file));
		if (fresh.length) setAttachments((current) => ({ ...current, [target.id]: [...files, ...fresh] }));
	};
	const detach = (index: number) =>
		target && setAttachments((current) => ({ ...current, [target.id]: files.filter((_, at) => at !== index) }));
	const choose = () =>
		window.desk.documents
			.choose()
			.then(attach)
			.catch(() => target && setFailed({ id: target.id, message: "The file picker did not open. Try again." }));
	const onDrop = (event: DragEvent) => {
		setOver(false);
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		attach([...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)));
	};
	const attachButton = target && (
		<IconButton label="Attach a document" disabled={saving} className="size-8" onClick={() => void choose()}>
			<Paperclip size={16} strokeWidth={1.75} aria-hidden />
		</IconButton>
	);
	const attached = files.length > 0 && (
		<AttachedFiles names={files.map(fileName)} onRemove={saving ? undefined : detach} />
	);

	const step = (by: number) => {
		onPick(open[(position + by + open.length) % open.length].id);
	};

	return (
		<form
			onSubmit={submit}
			onDragOver={(event) => {
				if (!target || !event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
			}}
			onDrop={onDrop}
			className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5"
		>
			<div
				className={`rounded-2xl border bg-surface shadow-[0_1px_2px_rgb(18_19_22/4%)] transition-[border-color] duration-150 focus-within:border-accent ${
					over ? "border-accent" : "border-line-strong"
				}`}
			>
				{target && (
					<div className="flex items-start gap-2 border-b border-line py-1.5 pr-1.5 pl-3.5 text-xs leading-[18px]">
						<CornerDownRight size={13} strokeWidth={1.75} className="mt-[7.5px] shrink-0 text-ink-3" aria-hidden />
						<span className="shrink-0 py-[5px] text-ink-3">Replying to</span>
						{/* A long question keeps to three lines here; the whole of it is in the thread. */}
						<span className="min-w-0 flex-1 py-[5px] font-medium text-ink-2">
							<span className="line-clamp-3 text-pretty">{promptOf(target)}</span>
						</span>
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
							<span className="h-7" />
						)}
					</div>
				)}
				{target && choosing ? (
					<div className="px-3.5 pt-3 pb-3">
						<HaveChoice question={target} disabled={saving} onChoose={(have) => void send({ have })} />
						{attached && <div className="mt-2.5">{attached}</div>}
						<div className="mt-1 -mr-1.5 -mb-1 flex items-center justify-between gap-3">
							<p className={`text-xs ${error ? "text-danger" : "text-ink-3"}`} role={error ? "alert" : undefined}>
								{error ??
									(files.length
										? "Choose an answer to send it with what you attached."
										: "One click answers it. Your answer is saved, so it is asked once.")}
							</p>
							{attachButton}
						</div>
					</div>
				) : (
					<>
						<Textarea
							key={target?.id ?? "none"}
							rows={2}
							autoResize
							disabled={!target}
							readOnly={saving}
							value={draft}
							onValueChange={(value) => target && setDrafts((current) => ({ ...current, [target.id]: value }))}
							submitShortcut="mod+enter"
							placeholder={target ? "Your answer" : "Nothing to answer right now"}
							aria-label={target ? promptOf(target) : "Your answer"}
							style={{ outline: "none" }}
							className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-normal text-ink placeholder:text-ink-4"
						/>
						{attached && <div className="px-3.5 pt-2">{attached}</div>}
						<div className="flex items-center justify-between gap-3 pt-1 pr-2 pb-2 pl-3.5">
							<span className={`text-xs ${error ? "text-danger" : "text-ink-3"}`} role={error ? "alert" : undefined}>
								{error ?? (target ? `${sendKey} to send` : "The agent will ask here when it needs you")}
							</span>
							<span className="flex shrink-0 items-center gap-1">
								{attachButton}
								<button
									type="submit"
									aria-label="Send answer"
									disabled={!target || !(draft.trim() || files.length) || saving}
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
	onAnswer: (question: OpenQuestion, reply: QuestionReply, files: string[]) => Promise<void>;
};

export function QuestionsPage({ history, open: waiting, onAnswer }: Props) {
	const agent = useAgentState();
	const [targetId, setTargetId] = useState<string | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	// Whether the newest message is in view. Only then does the thread follow what arrives.
	const following = useRef(true);
	const [away, setAway] = useState(false);
	// Quick questions come first, so the one-click answers are out of the way before anything needs typing.
	const open = [...waiting.filter(awaitingChoice), ...waiting.filter((question) => !awaitingChoice(question))];
	const target = open.find((question) => question.id === targetId) ?? open[0];
	// The question being answered stays the one being answered when others arrive. The next one is
	// taken up only once this one is answered.
	if (target && target.id !== targetId) setTargetId(target.id);
	const usingAnswers = agent.status === "running" && agent.runLabel === "Using your answers";

	const toLatest = () => {
		const element = scroller.current;
		if (element) element.scrollTop = element.scrollHeight;
	};

	const onScroll = () => {
		const element = scroller.current;
		if (!element) return;
		following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
		setAway(!following.current);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the thread changes, and reads the scroll position then
	useLayoutEffect(() => {
		if (following.current) toLatest();
	}, [history, usingAnswers]);

	// The composer grows and shrinks, and takes the room from the thread.
	useEffect(() => {
		const element = scroller.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			if (following.current) element.scrollTop = element.scrollHeight;
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<section id="agent-panel" aria-label="Questions" className="flex min-h-0 flex-1 flex-col">
			<PageHeader title="Questions">
				{open.length > 0 && (
					<Chip tone="attention">{open.length === 1 ? "1 waiting for you" : `${open.length} waiting for you`}</Chip>
				)}
			</PageHeader>

			<div className="relative flex min-h-0 flex-1 flex-col">
				<div ref={scroller} onScroll={onScroll} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
					{history.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center px-6 text-center">
							<Avatar />
							<h2 className="mt-3 text-sm font-semibold">No questions yet</h2>
							<p className="mt-1 max-w-[44ch] text-ink-3">
								When the agent needs something only you know, it asks here. Your answers are saved to what it knows
								about you, so each one is asked once.
							</p>
						</div>
					) : (
						<ol className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pt-6 pb-4">
							<li className="pb-1 text-center text-xs text-ink-3">
								The agent asks here when it needs something only you know. Each answer is saved, so it is asked once.
							</li>
							{history.flatMap((question) => {
								const ask = (
									<AgentMessage
										key={`q-${question.id}`}
										question={question}
										replying={question.id === target?.id}
										canPick={open.length > 1}
										onPick={() => setTargetId(question.id)}
									/>
								);
								return question.answer ? [ask, <UserMessage key={`a-${question.id}`} question={question} />] : [ask];
							})}
							{usingAnswers && <Working label="Carrying on with your answers" />}
						</ol>
					)}
				</div>
				{away && (
					<button
						type="button"
						aria-label="Jump to the latest"
						title="Jump to the latest"
						onClick={toLatest}
						className="pressable absolute bottom-2 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-[0_1px_2px_rgb(18_19_22/8%)] transition-[opacity] duration-150 hover:bg-fill-hover hover:text-ink starting:opacity-0 motion-reduce:transition-none"
					>
						<ArrowDown size={15} strokeWidth={1.75} aria-hidden />
					</button>
				)}
			</div>

			<Composer open={open} target={target} onPick={setTargetId} onAnswer={onAnswer} />
		</section>
	);
}
