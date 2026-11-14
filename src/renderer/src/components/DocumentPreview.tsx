import type { ApplicationDocument } from "@shared/application";
import { Download, FileText, X } from "lucide-react";
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
	onClose: () => void;
};

/** A quick look at one of a card's documents, in a panel beside the card. */
export function DocumentPreview({ applicationId, document, onClose }: Props) {
	const kind = kindOf(document.file);
	const source = sourceOf(applicationId, document.file);
	const download = () => void window.desk.applications.saveDocument(applicationId, document.file);

	return (
		<>
			<header className="flex h-14 shrink-0 items-center gap-2.5 pr-3 pl-5">
				<FileText size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
				<p className="selectable min-w-0 flex-1 truncate font-medium">{document.file}</p>
				<Button size="sm" icon={<Download size={13} strokeWidth={1.75} aria-hidden />} onClick={download}>
					Download
				</Button>
				<IconButton label="Close the preview" onClick={onClose}>
					<X size={16} strokeWidth={1.75} aria-hidden />
				</IconButton>
			</header>

			<div className="min-h-0 flex-1 px-5 pb-5">
				<div className="size-full overflow-hidden rounded-xl border border-line-strong bg-column">
					{kind === "pdf" && (
						<iframe
							title={`${document.label}: ${document.file}`}
							src={`${source}#navpanes=0&view=FitH`}
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
						<div className="scroll-quiet size-full overflow-auto p-5">
							<img src={source} alt={document.label} className="mx-auto max-w-full rounded-md shadow-card" />
						</div>
					)}
					{kind === "other" && (
						<div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
							<span className="flex size-10 items-center justify-center rounded-lg bg-fill-hover text-ink-2">
								<FileText size={18} strokeWidth={1.75} aria-hidden />
							</span>
							<p className="max-w-[36ch] text-ink-2">
								This kind of file cannot be shown here. Download it, or open it from the card's folder.
							</p>
						</div>
					)}
				</div>
			</div>
		</>
	);
}
