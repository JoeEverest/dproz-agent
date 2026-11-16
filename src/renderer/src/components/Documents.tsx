import type { LinkAdded, WorkspaceDocument } from "@shared/ipc";
import { linkParts, normaliseLink } from "@shared/links";
import { FilePlus2, FileText, Link2, X } from "lucide-react";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { fileSize } from "../lib/format";
import { useResource } from "../lib/hooks";
import { Button, IconButton, Input } from "./ui";

/** A link dragged in from a browser, when the drop carries one. */
export function droppedLink(event: DragEvent): string | null {
	const first = event.dataTransfer
		.getData("text/uri-list")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("#"));
	return first ? normaliseLink(first) : null;
}

/** Paste a link to a page or a file. A file is downloaded as a document; a page is kept as a link. */
export function LinkField({
	onAdded,
	compact = false,
	disabled = false,
	onBusyChange,
}: {
	onAdded: (result: LinkAdded) => void;
	compact?: boolean;
	disabled?: boolean;
	onBusyChange?: (busy: boolean) => void;
}) {
	const [value, setValue] = useState("");
	const submitting = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (submitting.current || disabled) return;
		if (!normaliseLink(value)) {
			setError("That does not look like a web link.");
			return;
		}
		submitting.current = true;
		setBusy(true);
		onBusyChange?.(true);
		setError(null);
		try {
			onAdded(await window.desk.documents.addLink(value));
			setValue("");
		} catch {
			setError("The link was not added. Try again.");
		} finally {
			submitting.current = false;
			setBusy(false);
			onBusyChange?.(false);
		}
	};

	return (
		<form onSubmit={(event) => void submit(event)}>
			<div className={`flex gap-2 ${compact ? "flex-col items-start" : ""}`}>
				<Input
					aria-label="Link to a page or file about you"
					disabled={busy || disabled}
					value={value}
					onValueChange={(next) => {
						setValue(next);
						setError(null);
					}}
					placeholder={
						compact
							? "Paste a portfolio or document link"
							: "Or paste a link: a portfolio, a profile, a resume kept online"
					}
					autoComplete="off"
					spellCheck={false}
				/>
				<Button
					type="submit"
					disabled={busy || disabled || !value.trim()}
					icon={<Link2 size={14} strokeWidth={1.75} aria-hidden />}
				>
					{busy ? "Adding" : "Add link"}
				</Button>
			</div>
			{error && (
				<p role="alert" className="mt-1 text-xs text-danger">
					{error}
				</p>
			)}
		</form>
	);
}

export function DocumentsPanel({ onAdded }: { onAdded?: (names: string[]) => void }) {
	const documents = useResource(() => window.desk.documents.list());
	const links = useResource(() => window.desk.documents.links());
	const [over, setOver] = useState(false);
	const list = documents.data ?? [];

	const accept = (next: WorkspaceDocument[]) => {
		const known = new Set(list.map((document) => document.name));
		const added = next.filter((document) => !known.has(document.name)).map((document) => document.name);
		documents.setData(next);
		if (added.length) onAdded?.(added);
	};

	const onDrop = async (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const link = droppedLink(event);
		const paths = [...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)).filter(Boolean);
		if (paths.length) accept(await window.desk.documents.add(paths));
		else if (link) acceptLink(await window.desk.documents.addLink(link));
	};

	const acceptLink = (result: LinkAdded) => {
		accept(result.documents);
		links.setData(result.links);
	};

	return (
		<div>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target with a button inside for keyboard and pointer use */}
			<div
				onDragOver={(event) => {
					event.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(event) => void onDrop(event)}
				className={`flex items-center justify-between gap-4 rounded-xl border border-dashed py-3 pr-3 pl-4 transition-[background-color,border-color] duration-150 ${
					over ? "border-accent bg-accent-wash" : "border-line-strong"
				}`}
			>
				<p className="text-sm text-ink-2">
					Drop files here: resume, certificates, references, transcripts, old cover letters.
				</p>
				<Button
					icon={<FilePlus2 size={14} strokeWidth={1.75} aria-hidden />}
					onClick={async () => accept(await window.desk.documents.pick())}
				>
					Choose files
				</Button>
			</div>
			<div className="mt-2">
				<LinkField onAdded={acceptLink} />
			</div>
			{list.length + (links.data?.length ?? 0) > 0 && (
				<ul className="mt-2 flex flex-col">
					{list.map((document) => (
						<li key={document.name} className="group flex items-center gap-2.5 rounded-md py-1 pr-1 pl-2 hover:bg-fill">
							<FileText size={15} className="shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
							<span className="selectable min-w-0 flex-1 truncate text-sm">{document.name}</span>
							<span className="shrink-0 text-xs text-ink-3 tabular-nums">{fileSize(document.sizeBytes)}</span>
							<IconButton
								label={`Remove ${document.name}`}
								className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
								onClick={async () => documents.setData(await window.desk.documents.remove(document.name))}
							>
								<X size={14} strokeWidth={1.75} aria-hidden />
							</IconButton>
						</li>
					))}
					{(links.data ?? []).map((link) => (
						<li key={link.url} className="group flex items-center gap-2.5 rounded-md py-1 pr-1 pl-2 hover:bg-fill">
							<Link2 size={15} className="shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
							<span className="selectable min-w-0 flex-1 truncate text-sm">
								{linkParts(link.url).site}
								<span className="text-ink-3">{linkParts(link.url).page}</span>
							</span>
							<IconButton
								label={`Remove the link to ${linkParts(link.url).site}`}
								className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
								onClick={async () => links.setData(await window.desk.documents.removeLink(link.url))}
							>
								<X size={14} strokeWidth={1.75} aria-hidden />
							</IconButton>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
