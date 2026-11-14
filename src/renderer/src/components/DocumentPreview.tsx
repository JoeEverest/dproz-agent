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

const encode = (file: string) => file.split("/").map(encodeURIComponent).join("/");

/** Where the window reads a card's document from. */
export const cardDocument = (applicationId: string, file: string) =>
	`desk-doc://application/${encodeURIComponent(applicationId)}/${encode(file)}`;

/** Where the window reads one of the user's own documents from. */
export const ownDocument = (name: string) => `desk-doc://documents/${encode(name)}`;

type Props = {
	/** The file's name, shown in the header and used to tell what kind of file it is. */
	file: string;
	/** What the document is, for people using a screen reader. */
	label: string;
	source: string;
	/** Where else to find a file that cannot be shown here. */
	elsewhere: string;
	onDownload: () => void;
	onClose: () => void;
};

/** A quick look at a document, in a panel beside the list it was opened from. */
export function DocumentPreview({ file, label, source, elsewhere, onDownload, onClose }: Props) {
	const kind = kindOf(file);

	return (
		<>
			<header className="flex h-14 shrink-0 items-center gap-2.5 pr-3 pl-5">
				<FileText size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
				<p className="selectable min-w-0 flex-1 truncate font-medium">{file}</p>
				<Button size="sm" icon={<Download size={13} strokeWidth={1.75} aria-hidden />} onClick={onDownload}>
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
							title={`${label}: ${file}`}
							src={`${source}#navpanes=0&view=FitH`}
							className="block size-full border-0"
						/>
					)}
					{kind === "text" && (
						<iframe title={`${label}: ${file}`} src={source} className="block size-full border-0 bg-white" />
					)}
					{kind === "image" && (
						<div className="scroll-quiet size-full overflow-auto p-5">
							<img src={source} alt={label} className="mx-auto max-w-full rounded-md shadow-card" />
						</div>
					)}
					{kind === "other" && (
						<div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
							<span className="flex size-10 items-center justify-center rounded-lg bg-fill-hover text-ink-2">
								<FileText size={18} strokeWidth={1.75} aria-hidden />
							</span>
							<p className="max-w-[36ch] text-ink-2">
								This kind of file cannot be shown here. Download it, or {elsewhere}.
							</p>
						</div>
					)}
				</div>
			</div>
		</>
	);
}
