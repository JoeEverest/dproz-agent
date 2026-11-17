import { attachedAnswer, awaitingChoice, type QuestionReply } from "@shared/application";
import { answerLinks } from "@shared/links";
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
import { type DragEvent, type FormEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { useAgentState } from "../lib/agent";
import { relativeTime } from "../lib/format";
import { type OpenQuestion, questionKey, questionQueue } from "../lib/questionOrder";
import { useQuestionScroll } from "../lib/useQuestionScroll";
import { HaveChoice } from "./HaveChoice";
import { PageHeader } from "./PageHeader";
import { Button, Chip, IconButton } from "./ui";

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

function AttachedFiles({ names, onRemove }: { names: string[]; onRemove?: (index: number) => void }) {
	return (
		<ul aria-label="Attached documents" className="flex flex-wrap gap-1.5">
			{names.map((name, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: two attached files can share a name
					key={`${name}-${index}`}
					className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface py-1 pr-1 pl-2 text-xs text-ink-2"
				>
					<FileText size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
					<span className="truncate">{name}</span>
					{onRemove ? (
						<IconButton label={`Remove ${name}`} className="size-5" onClick={() => onRemove(index)}>
							<X size={12} strokeWidth={2} aria-hidden />
						</IconButton>
					) : (
						<span className="w-1" />
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
		<li data-message={`q-${questionKey(question)}`} className="flex items-start gap-2.5">
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
	// An answer that is only files reads as the files.
	const filesOnly = documents.length > 0 && text === attachedAnswer(documents);
	return (
		<li data-message={`a-${questionKey(question)}`} className="flex flex-col items-end">
			{!filesOnly && (
				<p className="selectable max-w-[78%] rounded-2xl rounded-tr-md bg-solid px-3.5 py-2.5 whitespace-pre-wrap text-on-solid">
					{text}
				</p>
			)}
			{documents.length > 0 && (
				<div className={`flex max-w-[78%] justify-end ${filesOnly ? "" : "mt-1.5"}`}>
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
	formRef: RefObject<HTMLFormElement | null>;
	open: OpenQuestion[];
	target: OpenQuestion | undefined;
	onPick: (question: OpenQuestion) => void;
	unavailable: boolean;
	onContinue: () => void;
	onSaving: (saving: boolean) => void;
	onAnswer: (question: OpenQuestion, reply: QuestionReply, files: string[]) => Promise<void>;
};

function Composer({ formRef, open, target, onPick, onAnswer, unavailable, onContinue, onSaving }: ComposerProps) {
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const key = target ? questionKey(target) : "";
	const draft = drafts[key] ?? "";
	// Files wait here, with the question they were attached for, and are only added when it is answered.
	const [attachments, setAttachments] = useState<Record<string, string[]>>({});
	const files = attachments[key] ?? [];
	const attach = (paths: string[]) => {
		if (!key || !paths.length) return;
		setAttachments((current) => ({ ...current, [key]: [...(current[key] ?? []), ...paths] }));
	};
	const detach = (index: number) =>
		setAttachments((current) => ({ ...current, [key]: files.filter((_, at) => at !== index) }));
	const sending = useRef(false);
	const [saving, setSaving] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const error = errors[key];
	const position = open.findIndex((question) => questionKey(question) === key);
	// A quick question is answered with a click, and only with a click.
	const choosing = Boolean(target && awaitingChoice(target));

	const send = async (reply: QuestionReply) => {
		if (!target || unavailable || sending.current) return;
		sending.current = true;
		setSaving(true);
		onSaving(true);
		setErrors((current) => ({ ...current, [key]: "" }));
		try {
			await onAnswer(target, reply, files);
			setDrafts((current) => ({ ...current, [key]: "" }));
			setAttachments((current) => ({ ...current, [key]: [] }));
		} catch (cause) {
			const message = (cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
			setErrors((current) => ({ ...current, [key]: `That did not send: ${message}` }));
		} finally {
			sending.current = false;
			setSaving(false);
			onSaving(false);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (draft.trim() || files.length) void send(draft.trim());
	};

	const canAttach = Boolean(target) && !saving && !unavailable;
	const choose = async () => {
		if (!canAttach) return;
		try {
			attach(await window.desk.documents.choose());
		} catch {
			setErrors((current) => ({ ...current, [key]: "The file picker did not open. Try again." }));
		}
	};
	const onDrop = (event: DragEvent) => {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		if (!canAttach) return;
		attach([...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)).filter(Boolean));
	};
	const attachButton = target && (
		<IconButton label="Attach a document" disabled={!canAttach} className="size-8" onClick={() => void choose()}>
			<Paperclip size={16} strokeWidth={1.75} aria-hidden />
		</IconButton>
	);
	const attached = files.length > 0 && (
		<div className="px-3.5 pt-2.5">
			<AttachedFiles names={files.map(fileName)} onRemove={saving ? undefined : detach} />
		</div>
	);

	const step = (by: number) => {
		onPick(open[(position + by + open.length) % open.length]);
	};

	return (
		<form
			ref={formRef}
			aria-label="Answer the selected question"
			onSubmit={submit}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault();
			}}
			onDrop={onDrop}
			className="mx-auto max-h-[60%] w-full max-w-[720px] shrink-0 overflow-y-auto px-6 pb-5"
		>
			<div className="rounded-2xl border border-line-strong bg-surface shadow-[0_1px_2px_rgb(18_19_22/4%)] transition-[border-color] duration-150 focus-within:border-accent">
				{target && (
					<div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3.5 text-xs">
						<CornerDownRight size={13} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
						<span className="shrink-0 text-ink-3">Replying to</span>
						<span className="min-w-0 flex-1 font-medium text-ink-2">{choosing ? "Quick question" : "Question"}</span>
						{open.length > 1 && !unavailable ? (
							<span className="flex shrink-0 items-center text-ink-3 tabular-nums">
								<IconButton label="Previous question" disabled={saving} className="size-6" onClick={() => step(-1)}>
									<ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
								</IconButton>
								{position + 1} of {open.length}
								<IconButton label="Next question" disabled={saving} className="size-6" onClick={() => step(1)}>
									<ChevronRight size={14} strokeWidth={1.75} aria-hidden />
								</IconButton>
							</span>
						) : (
							<span className="h-6" />
						)}
					</div>
				)}
				{target && (
					<section
						key={key}
						aria-label="Selected question context"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: long question context needs keyboard scrolling
						tabIndex={0}
						className="max-h-[24vh] overflow-y-auto border-b border-line px-3.5 py-3"
					>
						{target.about && (
							<p className="mb-1.5 flex items-start gap-1.5 text-xs text-ink-3">
								<Briefcase size={12} className="mt-0.5 shrink-0" aria-hidden />
								<span>{target.about.label}</span>
							</p>
						)}
						<p className="selectable font-medium whitespace-pre-wrap wrap-anywhere">
							{choosing ? ASKING[target.category ?? "none"] : promptOf(target)}
						</p>
						{target.why && (
							<p className="selectable mt-1 text-xs text-ink-2 whitespace-pre-wrap wrap-anywhere">{target.why}</p>
						)}
					</section>
				)}
				{unavailable && (
					<div className="px-3.5 py-3">
						<p role="status" className="mb-2 text-xs text-ink-2">
							This question was answered elsewhere or is no longer available.
							{draft
								? " Your draft is kept below; copy it if you need it before continuing."
								: " Choose another question to continue."}
						</p>
						<Button size="sm" onClick={onContinue}>
							Continue to next question
						</Button>
					</div>
				)}

				{target && choosing ? (
					<div className="px-3.5 pt-3 pb-3">
						<HaveChoice question={target} disabled={saving || unavailable} onChoose={(have) => void send({ have })} />
						{files.length > 0 && (
							<div className="mt-2.5">
								<AttachedFiles names={files.map(fileName)} onRemove={saving ? undefined : detach} />
							</div>
						)}
						<div className="mt-1.5 flex items-center justify-between gap-3">
							<p className={`text-xs ${error ? "text-danger" : "text-ink-3"}`} role={error ? "alert" : undefined}>
								{error ??
									(files.length
										? "Choose an answer to send it with the attached documents."
										: "One click answers it. Your answer is saved, so it is asked once.")}
							</p>
							{attachButton}
						</div>
					</div>
				) : (
					<>
						<Textarea
							key={key || "none"}
							rows={2}
							autoResize
							disabled={!target}
							readOnly={saving || unavailable}
							value={draft}
							onValueChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
							submitShortcut="mod+enter"
							placeholder={target ? "Your answer" : "Nothing to answer right now"}
							aria-label={target ? promptOf(target) : "Your answer"}
							style={{ outline: "none" }}
							className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-normal text-ink placeholder:text-ink-4"
						/>
						{attached}
						<div className="flex items-center justify-between gap-3 pt-1 pr-2 pb-2 pl-3.5">
							<span className={`text-xs ${error ? "text-danger" : "text-ink-3"}`} role={error ? "alert" : undefined}>
								{error ??
									(!target
										? "The agent will ask here when it needs you"
										: answerLinks(draft).length
											? `${sendKey} to send. Links in it are added to your profile.`
											: `${sendKey} to send`)}
							</span>
							<span className="flex shrink-0 items-center gap-1">
								{attachButton}
								<button
									type="submit"
									aria-label="Send answer"
									disabled={!target || !(draft.trim() || files.length) || saving || unavailable}
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
	const [selected, setSelected] = useState<OpenQuestion | null>(null);
	const [answered, setAnswered] = useState<Set<string>>(() => new Set());
	const [saving, setSaving] = useState(false);
	const scroll = useQuestionScroll();
	const formRef = useRef<HTMLFormElement>(null);
	const focusRequested = useRef(false);
	const pick = (question: OpenQuestion | null) => {
		focusRequested.current = true;
		setSelected(question);
	};
	const open = questionQueue(waiting.filter((question) => !answered.has(questionKey(question))));
	const current = selected && open.find((question) => questionKey(question) === questionKey(selected));
	const target = current ?? selected ?? undefined;
	const unavailable = Boolean(selected && !current && !saving);
	useLayoutEffect(() => {
		if (!selected && open[0]) setSelected(open[0]);
		const pending = new Set(waiting.map(questionKey));
		if ([...answered].some((key) => !pending.has(key))) {
			setAnswered(new Set([...answered].filter((key) => pending.has(key))));
		}
		if (selected && focusRequested.current) {
			formRef.current?.querySelector<HTMLElement>("textarea, fieldset button")?.focus({ preventScroll: true });
			focusRequested.current = false;
		}
	}, [selected, open, answered, waiting]);

	const answer = async (question: OpenQuestion, reply: QuestionReply, files: string[]) => {
		await onAnswer(question, reply, files);
		setAnswered((current) => new Set(current).add(questionKey(question)));
		setSelected(null);
	};
	const usingAnswers = agent.status === "running" && agent.runLabel === "Using your answers";

	return (
		<section id="agent-panel" aria-label="Questions" className="flex min-h-0 flex-1 flex-col">
			<PageHeader title="Questions">
				{open.length > 0 && (
					<Chip tone="attention">{open.length === 1 ? "1 waiting for you" : `${open.length} waiting for you`}</Chip>
				)}
			</PageHeader>

			<section
				ref={scroll.scroller}
				onScroll={scroll.onScroll}
				aria-label="Question history"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: history needs keyboard scrolling
				tabIndex={0}
				className="scroll-quiet min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
			>
				<div ref={scroll.content} className="flex min-h-full flex-col">
					{history.length === 0 ? (
						<div className="flex flex-1 flex-col items-center justify-center px-6 py-6 text-center">
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
										key={`q-${questionKey(question)}`}
										question={question}
										replying={Boolean(target && questionKey(question) === questionKey(target))}
										canPick={!saving && open.length > 0}
										onPick={() => pick(question)}
									/>
								);
								return question.answer
									? [ask, <UserMessage key={`a-${questionKey(question)}`} question={question} />]
									: [ask];
							})}
							{usingAnswers && <Working label="Carrying on with your answers" />}
						</ol>
					)}
				</div>
			</section>

			<div className="flex h-10 shrink-0 items-center justify-center">
				{scroll.away && (
					<button
						type="button"
						aria-label="Jump to latest"
						title="Jump to latest"
						onClick={scroll.toBottom}
						className="pressable flex size-8 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 hover:bg-fill-hover"
					>
						<ArrowDown size={16} aria-hidden />
					</button>
				)}
			</div>
			<Composer
				formRef={formRef}
				open={open}
				target={target}
				unavailable={unavailable}
				onContinue={() => pick(null)}
				onPick={pick}
				onAnswer={answer}
				onSaving={setSaving}
			/>
		</section>
	);
}
