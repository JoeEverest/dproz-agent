import type { ApplicationDocument } from "@shared/application";
import { APPLICATION_STATUSES, type Application, type ApplicationStatus, STATUS_LABELS } from "@shared/application";
import {
	AlertDialog,
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";
import {
	Drawer,
	DrawerBackdrop,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "@ui-sdk/react/drawer";
import {
	Banknote,
	Briefcase,
	CalendarClock,
	Check,
	CircleDashed,
	Copy,
	Download,
	ExternalLink,
	Eye,
	EyeOff,
	FileText,
	FolderOpen,
	Globe,
	LoaderCircle,
	type LucideIcon,
	Mail,
	MapPin,
	Minus,
	Send,
	Target,
	Trash2,
	X,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { deadline, hostOf, relativeTime } from "../lib/format";
import { fitLabel, statusIcon } from "./Board";
import { DocumentPreview } from "./DocumentPreview";
import { Markdown } from "./Markdown";
import { QuestionForm } from "./QuestionForm";
import { Button, buttonClass, Chip, IconButton, Picker } from "./ui";

const statusOptions = APPLICATION_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }));
const fitTone = { strong: "success", good: "success", stretch: "attention", poor: "danger" } as const;

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
	return (
		<section className="mt-7">
			<h3 className="mb-2 flex items-baseline gap-2 font-semibold">
				{title}
				{count !== undefined && <span className="text-xs font-normal text-ink-3 tabular-nums">{count}</span>}
			</h3>
			{children}
		</section>
	);
}

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
	return (
		<>
			<dt className="flex h-8 items-center gap-2 text-ink-3">
				<Icon size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
				{label}
			</dt>
			<dd className="flex min-h-8 min-w-0 items-center">{children}</dd>
		</>
	);
}

function CopyButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1600);
	};
	return (
		<Button
			size="sm"
			tone="quiet"
			onClick={() => void copy()}
			icon={
				<span className="icon-swap" aria-hidden>
					<Copy size={12} strokeWidth={1.75} data-hidden={copied} />
					<Check size={12} strokeWidth={2.25} data-hidden={!copied} className="text-accent" />
				</span>
			}
		>
			<span aria-live="polite">{copied ? "Copied" : label}</span>
		</Button>
	);
}

function EmailDraft({ application }: { application: Application }) {
	const draft = application.emailDraft;
	if (!draft) return null;
	const mailto = `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
	return (
		<Section title="Email to send">
			<div className="rounded-lg border border-line">
				<dl className="grid grid-cols-[64px_1fr] gap-y-1 border-b border-line px-3 py-2.5">
					<dt className="text-ink-3">To</dt>
					<dd className="selectable [overflow-wrap:anywhere]">{draft.to}</dd>
					<dt className="text-ink-3">Subject</dt>
					<dd className="selectable font-medium">{draft.subject}</dd>
				</dl>
				<p className="selectable px-3 py-2.5 whitespace-pre-wrap">{draft.body}</p>
				<div className="flex flex-wrap items-center gap-1 border-t border-line bg-fill px-2 py-1.5">
					<Button
						size="sm"
						icon={<Mail size={12} strokeWidth={1.75} aria-hidden />}
						onClick={() => void window.desk.shell.openExternal(mailto)}
					>
						Open in mail app
					</Button>
					<CopyButton text={draft.body} label="Copy message" />
					<CopyButton text={draft.to} label="Copy address" />
				</div>
			</div>
			<p className="mt-2 text-xs text-ink-3">Attach the documents above, send it, then press I've sent it.</p>
		</Section>
	);
}

function FitList({ heading, items, positive }: { heading: string; items: string[]; positive: boolean }) {
	if (items.length === 0) return null;
	return (
		<div>
			<p className="text-xs font-medium text-ink-3">{heading}</p>
			<ul className="mt-1.5 flex flex-col gap-1.5">
				{items.map((item) => (
					<li key={item} className="flex items-start gap-2 leading-snug">
						{positive ? (
							<Check size={14} strokeWidth={2} className="mt-px shrink-0 text-sent" aria-hidden />
						) : (
							<Minus size={14} strokeWidth={2} className="mt-px shrink-0 text-attention-mark" aria-hidden />
						)}
						<span className="selectable">{item}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function RemoveCard({ onConfirm }: { onConfirm: () => void }) {
	return (
		<AlertDialog onOpenChange={(open, details) => !open && details.returnValue === "confirm" && onConfirm()}>
			<AlertDialogTrigger className={buttonClass("danger", "sm", true)}>
				<Trash2 size={12} strokeWidth={1.75} aria-hidden />
				Remove from board
			</AlertDialogTrigger>
			<AlertDialogBackdrop className="fixed inset-0 bg-scrim transition-[opacity] duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
			<AlertDialogContent className="app fixed inset-0 m-auto h-fit w-[360px] max-w-[calc(100vw-48px)] rounded-xl bg-surface p-4 text-ink shadow-pop transition-[opacity,scale] duration-200 ease-(--ease-out) data-ending-style:scale-96 data-ending-style:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:transition-[opacity]">
				<AlertDialogTitle className="text-sm font-semibold">Remove this card?</AlertDialogTitle>
				<AlertDialogDescription className="mt-1 text-ink-2">
					Its folder is deleted too, including the tailored resume and cover letter. This cannot be undone.
				</AlertDialogDescription>
				<div className="mt-4 flex justify-end gap-2">
					<AlertDialogClose className={buttonClass("secondary", "sm")}>Keep it</AlertDialogClose>
					<AlertDialogClose value="confirm" className={buttonClass("destructive", "sm")}>
						Remove
					</AlertDialogClose>
				</div>
			</AlertDialogContent>
		</AlertDialog>
	);
}

type DrawerProps = {
	application: Application | null;
	liveStep?: string;
	onClose: () => void;
	onChanged: () => Promise<void>;
};

export function ApplicationDrawer({ application, liveStep, onClose, onChanged }: DrawerProps) {
	const lastShown = useRef<Application | null>(null);
	if (application) lastShown.current = application;
	const shown = application ?? lastShown.current;
	const [previewing, setPreviewing] = useState<ApplicationDocument | null>(null);
	// The panel keeps showing its last document while it slides away, then lets go of it.
	const [leaving, setLeaving] = useState<ApplicationDocument | null>(null);
	const openId = application?.id;

	const closePreview = () => {
		setLeaving(previewing);
		setPreviewing(null);
	};

	// A preview belongs to the card it was opened from.
	// biome-ignore lint/correctness/useExhaustiveDependencies: close whenever another card (or none) is shown
	useEffect(closePreview, [openId]);

	// The agent may rewrite or drop a document while it is being previewed.
	const preview = previewing && shown?.documents.find((document) => document.file === previewing.file);
	const inPanel = preview ?? leaving;

	return (
		<Drawer side="right" open={application !== null} onOpenChange={(open) => !open && onClose()}>
			<DrawerBackdrop className="fixed inset-0 bg-scrim" />
			<DrawerContent
				style={{ "--preview": "min(660px, calc(100vw - 560px - 24px))" } as CSSProperties}
				className="app h-full w-[560px] overflow-visible text-ink outline-none"
			>
				{shown && inPanel && (
					<aside
						aria-label={`Preview of ${inPanel.label}`}
						data-open={Boolean(preview)}
						inert={!preview}
						onTransitionEnd={(event) => {
							if (event.target === event.currentTarget && !preview) setLeaving(null);
						}}
						className="preview-panel absolute top-0 right-full flex h-full w-(--preview) flex-col bg-canvas shadow-sheet"
					>
						<DocumentPreview applicationId={shown.id} document={inPanel} onClose={closePreview} />
					</aside>
				)}
				{shown && (
					<div className="relative flex size-full flex-col border-l border-line-strong bg-canvas shadow-sheet">
						<Sheet
							application={shown}
							liveStep={liveStep}
							onClose={onClose}
							onChanged={onChanged}
							previewing={preview?.file}
							onPreview={(document) => (preview?.file === document.file ? closePreview() : setPreviewing(document))}
						/>
					</div>
				)}
			</DrawerContent>
		</Drawer>
	);
}

type SheetProps = {
	application: Application;
	liveStep?: string;
	onClose: () => void;
	onChanged: () => Promise<void>;
	previewing?: string;
	onPreview: (document: ApplicationDocument) => void;
};

function Sheet({ application, liveStep, onClose, onChanged, previewing, onPreview }: SheetProps) {
	const settled = ["closed", "applied", "interview"].includes(application.status);
	const due = deadline(application.closesAt);
	const postingUrl = application.jobUrl ?? application.applyUrl;
	const sent = application.status === "applied" || application.status === "interview";
	const { icon: StatusIcon, color } = statusIcon[application.status];

	const setStatus = async (status: ApplicationStatus) => {
		await window.desk.applications.setStatus(application.id, status);
		await onChanged();
	};

	const remove = async () => {
		onClose();
		await window.desk.applications.remove(application.id);
		await onChanged();
	};

	return (
		<>
			<header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2.5 pl-6">
				<p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-3">
					<span>Jobs</span>
					<span aria-hidden>/</span>
					<StatusIcon size={13} strokeWidth={2} className={`shrink-0 ${color}`} aria-hidden />
					<span className="truncate text-ink-2">{STATUS_LABELS[application.status]}</span>
				</p>
				{postingUrl && (
					<IconButton label="Open the posting" onClick={() => void window.desk.shell.openExternal(postingUrl)}>
						<ExternalLink size={15} strokeWidth={1.75} aria-hidden />
					</IconButton>
				)}
				<IconButton label="Open its folder" onClick={() => void window.desk.applications.openFolder(application.id)}>
					<FolderOpen size={15} strokeWidth={1.75} aria-hidden />
				</IconButton>
				<DrawerClose
					aria-label="Close"
					className="pressable inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-fill-hover hover:text-ink"
				>
					<X size={16} strokeWidth={1.75} aria-hidden />
				</DrawerClose>
			</header>

			<div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-8">
				<DrawerTitle className="selectable text-sm leading-snug font-semibold text-balance">
					{application.title}
				</DrawerTitle>
				<DrawerDescription className="selectable mt-0.5 text-ink-2">{application.company}</DrawerDescription>

				{liveStep && (
					<p
						className="mt-4 flex items-center gap-2 rounded-lg bg-accent-wash px-3 py-2 text-accent-ink"
						aria-live="polite"
					>
						<LoaderCircle size={14} className="shrink-0 animate-spin [animation-duration:0.8s]" aria-hidden />
						<span className="font-medium">The agent is working on this now</span>
						<span className="truncate text-xs">{liveStep}</span>
					</p>
				)}

				{(application.status === "ready_to_submit" || application.status === "manual") && (
					<div className="mt-4 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
						<p className="min-w-0 flex-1 text-ink-2">
							{application.status === "manual"
								? "This employer only takes applications by email. The message and documents are ready for you."
								: application.hold
									? "You asked for this one to be prepared, not sent."
									: "Prepared and judged. It goes when you send it."}
						</p>
						{application.status === "manual" ? (
							<Button size="sm" tone="primary" onClick={() => void setStatus("applied")}>
								I've sent it
							</Button>
						) : (
							<Button
								size="sm"
								tone="primary"
								icon={<Send size={12} strokeWidth={2} aria-hidden />}
								onClick={() => {
									void window.desk.applications.submit(application.id);
									onClose();
								}}
							>
								Submit now
							</Button>
						)}
					</div>
				)}

				<dl className="mt-4 grid grid-cols-[112px_minmax(0,1fr)] items-start">
					<Property icon={CircleDashed} label="Status">
						<Picker
							label="Status"
							value={application.status}
							options={statusOptions}
							onChange={(status) => void setStatus(status)}
							className="-ml-2.5"
						/>
					</Property>
					{application.fit && (
						<Property icon={Target} label="Fit">
							<Chip tone={fitTone[application.fit.verdict]}>{fitLabel[application.fit.verdict]}</Chip>
						</Property>
					)}
					{application.location && (
						<Property icon={MapPin} label="Location">
							<span className="selectable">{application.location}</span>
						</Property>
					)}
					{application.employmentType && (
						<Property icon={Briefcase} label="Type">
							<span className="selectable">{application.employmentType}</span>
						</Property>
					)}
					{application.salary && (
						<Property icon={Banknote} label="Salary">
							<span className="selectable">{application.salary}</span>
						</Property>
					)}
					{due && (
						<Property icon={CalendarClock} label="Deadline">
							<span className={due.urgent && !settled ? "font-medium text-danger" : ""}>{due.text}</span>
						</Property>
					)}
					<Property icon={Globe} label="Apply via">
						{application.applyMethod === "email" && application.applyEmail ? (
							<span className="selectable [overflow-wrap:anywhere]">{application.applyEmail}</span>
						) : postingUrl ? (
							<button
								type="button"
								className="truncate text-accent-ink underline-offset-2 hover:underline"
								onClick={() => void window.desk.shell.openExternal(application.applyUrl ?? postingUrl)}
							>
								{hostOf(application.applyUrl ?? postingUrl)}
							</button>
						) : (
							<span className="text-ink-3">Not known yet</span>
						)}
					</Property>
				</dl>

				<Section title={sent ? "Documents sent" : "Documents"} count={application.documents.length}>
					{application.documents.length === 0 ? (
						<p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-ink-3">
							Nothing yet. The tailored resume and cover letter appear here once the agent has written them.
						</p>
					) : (
						<ul className="flex flex-col gap-1.5">
							{application.documents.map((document) => {
								const open = previewing === document.file;
								return (
									<li
										key={document.file}
										className={`flex items-center gap-1 rounded-lg border pr-1.5 transition-[background-color,border-color] duration-150 ${
											open ? "border-accent bg-accent-wash" : "border-line bg-fill hover:bg-fill-hover"
										}`}
									>
										<button
											type="button"
											aria-pressed={open}
											aria-label={`Preview ${document.label}: ${document.file}`}
											onClick={() => onPreview(document)}
											className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 pr-1 pl-3 text-left"
										>
											<FileText size={16} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
											<span className="min-w-0 flex-1 truncate font-medium">{document.file}</span>
											<Chip>{document.label}</Chip>
										</button>
										<IconButton label={open ? "Close the preview" : "Preview"} onClick={() => onPreview(document)}>
											{open ? (
												<EyeOff size={15} strokeWidth={1.75} aria-hidden />
											) : (
												<Eye size={15} strokeWidth={1.75} aria-hidden />
											)}
										</IconButton>
										<IconButton
											label={`Download ${document.label}`}
											onClick={() => void window.desk.applications.saveDocument(application.id, document.file)}
										>
											<Download size={15} strokeWidth={1.75} aria-hidden />
										</IconButton>
									</li>
								);
							})}
						</ul>
					)}
				</Section>

				{application.questions.length > 0 && (
					<Section title="Questions from the agent" count={application.questions.length}>
						<div className="flex flex-col gap-2">
							{application.questions.map((question) => (
								<QuestionForm
									key={question.id}
									question={question}
									onAnswer={async (answer) => {
										await window.desk.applications.answer(application.id, question.id, answer);
										await onChanged();
									}}
								/>
							))}
						</div>
					</Section>
				)}

				<EmailDraft application={application} />

				{application.status === "closed" && application.closedReason && (
					<Section title="Why the agent closed this">
						<p className="selectable text-ink-2">{application.closedReason}</p>
					</Section>
				)}

				{application.fit && (
					<Section title="Fit check">
						<p className="selectable text-ink-2">{application.fit.summary}</p>
						{(application.fit.strengths.length > 0 || application.fit.gaps.length > 0) && (
							<div className="mt-3 grid grid-cols-2 gap-5">
								<FitList heading="In your favour" items={application.fit.strengths} positive />
								<FitList heading="Gaps" items={application.fit.gaps} positive={false} />
							</div>
						)}
					</Section>
				)}

				{application.strategy && (
					<Section title="How the agent pitched you">
						<Markdown>{application.strategy}</Markdown>
					</Section>
				)}

				{application.notes && (
					<Section title="Notes">
						<Markdown>{application.notes}</Markdown>
					</Section>
				)}

				<Section title="History">
					<ol className="relative flex flex-col gap-2.5 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-line-strong">
						{[...application.timeline].reverse().map((entry) => (
							<li key={`${entry.at}-${entry.event}`} className="relative flex items-baseline gap-3 pl-5">
								<span className="absolute top-[7px] left-0 size-[7px] rounded-full bg-ink-4 ring-2 ring-canvas" />
								<span className="selectable min-w-0 flex-1 text-ink-2">{entry.event}</span>
								<time dateTime={entry.at} className="shrink-0 text-xs text-ink-3 tabular-nums">
									{relativeTime(entry.at)}
								</time>
							</li>
						))}
					</ol>
				</Section>

				<div className="mt-7 border-t border-line pt-3">
					<RemoveCard onConfirm={() => void remove()} />
				</div>
			</div>
		</>
	);
}
