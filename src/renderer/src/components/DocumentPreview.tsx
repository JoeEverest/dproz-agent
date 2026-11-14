import type { ApplicationDocument } from "@shared/application";
import { DrawerClose } from "@ui-sdk/react/drawer";
import { ArrowLeft, ExternalLink, FileText, FolderOpen, X } from "lucide-react";
import { Button, IconButton } from "./ui";

const extension = (file: string) => file.split(".").pop()?.toLowerCase() ?? "";
const kindOf = (file: string) =>
	extension(file) === "pdf"
		? "pdf"
		: ["png", "jpg", "jpeg", "gif", "webp"].includes(extension(file))
			? "image"
			: ["txt", "md"].includes(extension(file))
				? "text"
				: "other";

const sourceOf = (applicationId: string, file: string) =>
	`desk-doc://application/${encodeURIComponent(applicationId)}/${file.split("/").map(encodeURIComponent).join("/")}`;

type Props = {
	applicationId: string;
	document: ApplicationDocument;
	onBack: () => void;
};

/** Shows one of a card's documents inside the drawer, so it can be read before it is opened or sent. */
export function DocumentPreview({ applicationId, document, onBack }: Props) {
	const kind = kindOf(document.file);
	const source = sourceOf(applicationId, document.file);
	const open = () => void window.desk.applications.openDocument(applicationId, document.file);

	return (
		<>
			<header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2.5 pl-3">
				<IconButton label="Back to the job" onClick={onBack}>
					<ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
				</IconButton>
				<p className="ml-1 flex min-w-0 flex-1 items-baseline gap-2">
					<span className="shrink-0 font-semibold">{document.label}</span>
					<span className="selectable truncate text-xs text-ink-3">{document.file}</span>
				</p>
				<Button size="sm" icon={<ExternalLink size={13} strokeWidth={1.75} aria-hidden />} onClick={open}>
					Open
				</Button>
				<IconButton
					label="Show in its folder"
					onClick={() => void window.desk.applications.showDocument(applicationId, document.file)}
				>
					<FolderOpen size={15} strokeWidth={1.75} aria-hidden />
				</IconButton>
				<DrawerClose
					aria-label="Close"
					className="pressable inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-fill-hover hover:text-ink"
				>
					<X size={16} strokeWidth={1.75} aria-hidden />
				</DrawerClose>
			</header>

			<div className="min-h-0 flex-1 bg-column">
				{kind === "pdf" && (
					<iframe
						title={`${document.label}: ${document.file}`}
						src={`${source}#toolbar=0&navpanes=0&view=FitH`}
						className="block size-full border-0"
					/>
				)}
				{kind === "text" && (
					<iframe
						title={`${document.label}: ${document.file}`}
						src={source}
						className="block size-full border-0 bg-white"
					/>
				)}
				{kind === "image" && (
					<div className="scroll-quiet size-full overflow-auto p-6">
						<img src={source} alt={document.label} className="mx-auto max-w-full rounded-md shadow-card" />
					</div>
				)}
				{kind === "other" && (
					<div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
						<span className="flex size-10 items-center justify-center rounded-lg bg-fill-hover text-ink-2">
							<FileText size={18} strokeWidth={1.75} aria-hidden />
						</span>
						<p className="max-w-[40ch] text-ink-2">
							This kind of file cannot be shown here. Open it in the app your computer uses for it.
						</p>
						<Button size="sm" tone="primary" onClick={open}>
							Open {document.file}
						</Button>
					</div>
				)}
			</div>
		</>
	);
}
