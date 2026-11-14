import type { WorkspaceDocument } from "@shared/ipc";
import { FilePlus2, FileText, X } from "lucide-react";
import { type DragEvent, useState } from "react";
import { fileSize } from "../lib/format";
import { useResource } from "../lib/hooks";
import { Button, IconButton } from "./ui";

export function DocumentsPanel({ onAdded }: { onAdded?: (names: string[]) => void }) {
	const documents = useResource(() => window.desk.documents.list());
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
		const paths = [...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)).filter(Boolean);
		if (paths.length) accept(await window.desk.documents.add(paths));
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
			{list.length > 0 && (
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
				</ul>
			)}
		</div>
	);
}
