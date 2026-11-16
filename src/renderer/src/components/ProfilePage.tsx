import type { LinkAdded, WorkspaceDocument } from "@shared/ipc";
import { linkParts } from "@shared/links";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { FileText, Link2, Plus, Trash2, Upload } from "lucide-react";
import { type CSSProperties, type DragEvent, useState } from "react";
import { fileSize, relativeTime } from "../lib/format";
import { useResource } from "../lib/hooks";
import { DocumentPreview, ownDocument } from "./DocumentPreview";
import { droppedLink, LinkField } from "./Documents";
import { MasterRecord } from "./MasterRecord";
import { buttonClass, IconButton } from "./ui";

/** The files and links the user has handed over, beside the master resume the agent wrote from them. */
function DocumentsBar() {
	const documents = useResource(() => window.desk.documents.list());
	const links = useResource(() => window.desk.documents.links());
	const [over, setOver] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Whether the place to add things is showing. Until the user says, it shows only while there is nothing yet.
	const [adding, setAdding] = useState<boolean | null>(null);
	// The file being previewed, and the one whose panel is still sliding away.
	const [previewing, setPreviewing] = useState<string | null>(null);
	const [leaving, setLeaving] = useState<string | null>(null);
	const list = documents.data ?? [];
	const linkList = links.data ?? [];
	const preview = list.find((document) => document.name === previewing)?.name ?? null;
	const inPanel = preview ?? leaving;
	const empty = Boolean(documents.data && links.data) && list.length + linkList.length === 0;
	const open = adding ?? empty;

	const closePreview = () => {
		setLeaving(preview);
		setPreviewing(null);
	};

	const accept = (next: WorkspaceDocument[]) => {
		// The first document must not close what the user is adding into.
		setAdding(open);
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

	/** Adding can fail part-way, on a file that cannot be read: say so, and hand over what did arrive. */
	const bringIn = async (add: () => Promise<void>) => {
		setError(null);
		try {
			await add();
		} catch {
			setError("Some documents could not be added. Check the list, then try again.");
			await window.desk.documents
				.list()
				.then(accept)
				.catch(() => {});
		}
	};

	const pick = () => bringIn(async () => accept(await window.desk.documents.pick()));

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const link = droppedLink(event);
		const paths = [...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)).filter(Boolean);
		void bringIn(async () => {
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
			{/* The whole bar takes a drop, and a file dragged over it brings the place to drop it into view. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; the Add button covers keyboard and pointer use */}
			<div
				onDragOver={(event) => {
					event.preventDefault();
					setOver(true);
					setAdding(true);
				}}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
				}}
				onDrop={onDrop}
				className="relative z-10 flex min-h-0 flex-1 flex-col bg-canvas"
			>
				<Collapsible open={open} onOpenChange={setAdding} className="shrink-0 border-b border-line">
					<div className="flex h-11 items-center justify-between gap-3 pr-3 pl-4">
						<h2 className="text-[13px] font-semibold">Your documents</h2>
						<CollapsibleTrigger className={`group ${buttonClass("secondary", "sm", true)}`}>
							<Plus
								size={13}
								strokeWidth={2}
								className="transition-[rotate] duration-200 ease-(--ease-out) group-data-open:rotate-45 motion-reduce:transition-none"
								aria-hidden
							/>
							{open ? "Close" : "Add"}
						</CollapsibleTrigger>
					</div>
					<CollapsiblePanel keepMounted className="collapse-panel">
						<div className="border-t border-line p-3">
							<button
								type="button"
								onClick={() => void pick()}
								className={`flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center text-ink-3 transition-[background-color,border-color] duration-150 hover:bg-fill ${
									over ? "border-accent bg-accent-wash text-accent-ink" : "border-line-strong"
								}`}
							>
								<Upload size={15} strokeWidth={1.75} aria-hidden />
								<span className="text-xs text-pretty">
									{empty ? "No documents yet. " : ""}Drop a resume, certificate, reference, transcript or old cover
									letter here, or click to choose files.
								</span>
							</button>
							<div className="mt-2">
								<LinkField onAdded={acceptLink} />
							</div>
							{error && (
								<p role="alert" className="mt-2 text-xs text-danger">
									{error}
								</p>
							)}
						</div>
					</CollapsiblePanel>
				</Collapsible>

				<div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-4">
					<ul>
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
