import type { LinkAdded, WorkspaceDocument } from "@shared/ipc";
import { linkParts } from "@shared/links";
import { FileText, Link2, Plus, Trash2 } from "lucide-react";
import { type CSSProperties, type DragEvent, useRef, useState } from "react";
import { fileSize, relativeTime } from "../lib/format";
import { useResource } from "../lib/hooks";
import { DocumentPreview, ownDocument } from "./DocumentPreview";
import { droppedLink, LinkField } from "./Documents";
import { MasterRecord } from "./MasterRecord";
import { Button, IconButton } from "./ui";

/** The files and links the user has handed over, beside the master resume the agent wrote from them. */
function DocumentsBar() {
	const documents = useResource(() => window.desk.documents.list());
	const links = useResource(() => window.desk.documents.links());
	const [over, setOver] = useState(false);
	const [busy, setBusy] = useState(false);
	const importing = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const setImporting = (value: boolean) => {
		importing.current = value;
		setBusy(value);
		if (value) setError(null);
	};

	const importSources = async (run: () => Promise<void>) => {
		if (importing.current) return;
		setImporting(true);
		setError(null);
		try {
			await run();
		} catch {
			setError("Some documents could not be added. Check the list, then try again.");
			// A batch can fail after copying some files; still hand those files to the agent.
			await window.desk.documents
				.list()
				.then(accept)
				.catch(() => {});
		} finally {
			setImporting(false);
		}
	};
	// The file being previewed, and the one whose panel is still sliding away.
	const [previewing, setPreviewing] = useState<string | null>(null);
	const [leaving, setLeaving] = useState<string | null>(null);
	const list = documents.data ?? [];
	const linkList = links.data ?? [];
	const preview = list.find((document) => document.name === previewing)?.name ?? null;
	const inPanel = preview ?? leaving;

	const closePreview = () => {
		setLeaving(preview);
		setPreviewing(null);
	};

	const accept = (next: WorkspaceDocument[]) => {
		const known = new Set(list.map((document) => document.name));
		const added = next.filter((document) => !known.has(document.name)).map((document) => document.name);
		documents.setData(next);
		if (added.length) void window.desk.agent.documentsAdded(added);
	};

	// A link to a file arrives as a document, which accept() hands to the agent; a page is handed over as a link.
	const acceptLink = (result: LinkAdded) => {
		accept(result.documents);
		links.setData(result.links);
		if (result.added?.kind === "link") void window.desk.agent.linksAdded([result.added.url]);
	};

	const onDrop = async (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const link = droppedLink(event);
		const paths = [...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)).filter(Boolean);
		await importSources(async () => {
			if (paths.length) accept(await window.desk.documents.add(paths));
			else if (link) acceptLink(await window.desk.documents.addLink(link));
		});
	};

	return (
		<aside
			aria-label="Your documents"
			style={{ "--preview": "min(700px, calc(100vw - 320px - 300px))" } as CSSProperties}
			className="relative flex w-[320px] shrink-0 flex-col border-l border-line"
		>
			{inPanel && (
				<aside
					aria-label={`Preview of ${inPanel}`}
					data-open={Boolean(preview)}
					inert={!preview}
					onTransitionEnd={(event) => {
						if (event.target === event.currentTarget && !preview) setLeaving(null);
					}}
					className="preview-panel absolute top-0 right-full z-10 flex h-full w-(--preview) flex-col bg-canvas shadow-sheet"
				>
					<DocumentPreview
						file={inPanel}
						label={inPanel}
						source={ownDocument(inPanel)}
						elsewhere="open it where you keep the original"
						onDownload={() => void window.desk.documents.save(inPanel)}
						onClose={closePreview}
					/>
				</aside>
			)}

			{/* Sits over the preview's shadow, so the bar and the panel read as two sheets. */}
			<div className="relative z-10 flex min-h-0 flex-1 flex-col bg-canvas">
				<div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line pr-3 pl-4">
					<h2 className="text-[13px] font-semibold">Your documents</h2>
				</div>

				<section aria-label="Add documents" className="max-h-[50%] shrink-0 overflow-y-auto border-b border-line p-3">
					{/* biome-ignore lint/a11y/noStaticElementInteractions: the file button and link form provide keyboard alternatives */}
					<div
						onDragOver={(event) => {
							event.preventDefault();
							if (!importing.current) setOver(true);
						}}
						onDragLeave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
						}}
						onDrop={(event) => void onDrop(event)}
						className={`space-y-3 rounded-lg border border-dashed p-3 transition-[background-color,border-color] duration-150 ${over ? "border-accent bg-accent-wash" : "border-line-strong"}`}
					>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								icon={<Plus size={13} strokeWidth={2} aria-hidden />}
								disabled={busy}
								onClick={() => void importSources(async () => accept(await window.desk.documents.pick()))}
							>
								Choose files
							</Button>
							<p className="text-xs text-ink-3">or drop files or a link here</p>
						</div>
						<LinkField onAdded={acceptLink} compact disabled={busy} onBusyChange={setImporting} />
					</div>
					{busy && (
						<p role="status" className="mt-2 text-xs text-ink-3">
							Adding documents…
						</p>
					)}
					{error && (
						<p role="alert" className="mt-2 text-xs text-danger">
							{error}
						</p>
					)}
				</section>

				<div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-4">
					{list.length + linkList.length === 0 && (
						<p className="px-2 py-3 text-xs text-ink-3">
							No documents yet. Add a resume, certificate or portfolio above.
						</p>
					)}
					<ul aria-label="Saved documents and links">
						{list.map((document) => {
							const open = preview === document.name;
							return (
								<li
									key={document.name}
									className={`group flex items-center gap-1 rounded-lg pr-1 ${open ? "bg-fill-hover" : "hover:bg-fill"}`}
								>
									<button
										type="button"
										aria-label={`Preview ${document.name}`}
										aria-pressed={open}
										onClick={() => (open ? closePreview() : setPreviewing(document.name))}
										className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-1 pl-2 text-left"
									>
										<FileText size={16} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
										<span className="min-w-0">
											<span className="block truncate font-medium">{document.name}</span>
											<span className="block text-xs text-ink-3 tabular-nums">
												{fileSize(document.sizeBytes)} · added {relativeTime(document.modifiedAt)}
											</span>
										</span>
									</button>
									<IconButton
										label={`Remove ${document.name}`}
										className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-danger-wash hover:text-danger"
										onClick={async () => {
											if (open) closePreview();
											documents.setData(await window.desk.documents.remove(document.name));
										}}
									>
										<Trash2 size={14} strokeWidth={1.75} aria-hidden />
									</IconButton>
								</li>
							);
						})}
						{linkList.map((link) => {
							const { site, page } = linkParts(link.url);
							return (
								<li key={link.url} className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-fill">
									<div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 pl-2">
										<Link2 size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
										<span className="min-w-0">
											<span className="selectable block truncate font-medium">
												{site}
												<span className="font-normal text-ink-3">{page}</span>
											</span>
											<span className="block text-xs text-ink-3">Link · added {relativeTime(link.addedAt)}</span>
										</span>
									</div>
									<IconButton
										label={`Remove the link to ${site}`}
										className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-danger-wash hover:text-danger"
										onClick={async () => links.setData(await window.desk.documents.removeLink(link.url))}
									>
										<Trash2 size={14} strokeWidth={1.75} aria-hidden />
									</IconButton>
								</li>
							);
						})}
					</ul>

					<p className="mx-2 mt-3 text-xs text-pretty text-ink-3">
						The agent reads these to write your master resume. Remove one and it stops using it.
					</p>
				</div>
			</div>
		</aside>
	);
}

export function ProfilePage() {
	return <MasterRecord aside={<DocumentsBar />} />;
}
