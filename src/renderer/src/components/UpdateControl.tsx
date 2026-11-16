import type { UpdateInfo } from "@shared/ipc";
import {
	AlertDialog,
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import { ArrowDownToLine, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button, buttonClass, IconButton } from "./ui";

/**
 * What the update control offers right now:
 * link         download the installer by hand (this copy cannot replace itself, or the download failed)
 * download     fetch the new version inside the app
 * downloading  wait
 * restart      close, install and open again
 */
type Step = "none" | "link" | "download" | "downloading" | "restart";

function stepOf(update: UpdateInfo | null): Step {
	if (!update?.available) return "none";
	if (!update.inPlace || update.stage === "failed") return "link";
	if (update.stage === "downloading") return "downloading";
	return update.stage === "ready" ? "restart" : "download";
}

const percent = (update: UpdateInfo | null) => Math.round((update?.progress ?? 0) * 100);

/** The sentence under the version number in Settings. */
export function updateNote(update: UpdateInfo): string | undefined {
	if (update.openingDownload) return "Checking the latest release before downloading.";
	if (update.error) return `The latest update could not be checked or opened. ${update.error}`;
	if (!update.available) return undefined;
	const version = `Version ${update.latest}`;
	if (update.stage === "failed") {
		return `${update.problem ?? "The update could not be installed."} Download ${version.toLowerCase()} from the site instead.`;
	}
	if (update.stage === "ready") return `${version} is downloaded. The app closes, installs it and opens again.`;
	if (update.stage === "downloading") return `Downloading ${version.toLowerCase()}.`;
	return update.blocked ? `${version} is available. ${update.blocked}` : `${version} is available.`;
}

function useUpdateAction(update: UpdateInfo | null) {
	const [asking, setAsking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const step = stepOf(update);
	const restart = () => void window.desk.updates.install();

	const act = async () => {
		if (update?.openingDownload) return;
		if (step === "link") {
			try {
				const latest = await window.desk.updates.openDownload();
				if (latest.error) setError(latest.error);
			} catch (cause) {
				setError((cause as Error).message);
			}
		}
		if (step === "download") void window.desk.updates.download();
		if (step === "restart") {
			// A restart stops whatever the agent is in the middle of, so it asks first.
			const agent = await window.desk.agent.state();
			if (agent.status === "idle") restart();
			else setAsking(true);
		}
	};

	const question = (
		<>
			<AlertDialog
				open={asking}
				onOpenChange={(open, details) => {
					if (open) return;
					setAsking(false);
					if (details.returnValue === "confirm") restart();
				}}
			>
				<AlertDialogBackdrop className="fixed inset-0 bg-scrim transition-[opacity] duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<AlertDialogContent className="app fixed inset-0 m-auto h-fit w-[360px] max-w-[calc(100vw-48px)] rounded-xl bg-surface p-4 text-ink shadow-pop transition-[opacity,scale] duration-200 ease-(--ease-out) data-ending-style:scale-96 data-ending-style:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:transition-[opacity]">
					<AlertDialogTitle className="text-sm font-semibold">Restart while the agent is working?</AlertDialogTitle>
					<AlertDialogDescription className="mt-1 text-ink-2">
						Restarting stops what it is doing now. It picks the work up again after the update.
					</AlertDialogDescription>
					<div className="mt-4 flex justify-end gap-2">
						<AlertDialogClose className={buttonClass("secondary", "sm")}>Not now</AlertDialogClose>
						<AlertDialogClose value="confirm" className={buttonClass("primary", "sm")}>
							Restart anyway
						</AlertDialogClose>
					</div>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog
				open={Boolean(error)}
				onOpenChange={(open) => {
					if (!open) setError(null);
				}}
			>
				<AlertDialogBackdrop className="fixed inset-0 bg-scrim" />
				<AlertDialogContent className="app fixed inset-0 m-auto h-fit w-[360px] max-w-[calc(100vw-48px)] rounded-xl bg-surface p-4 text-ink shadow-pop">
					<AlertDialogTitle className="text-sm font-semibold">Could not open the latest download</AlertDialogTitle>
					<AlertDialogDescription className="mt-1 text-ink-2">
						<span className="block">{error}</span>
						<span className="mt-2 block">No installer was opened. Try Download again.</span>
					</AlertDialogDescription>
					<div className="mt-4 flex justify-end">
						<AlertDialogClose className={buttonClass("secondary", "sm")}>Close</AlertDialogClose>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);

	return { step, act, question };
}

function ProgressRing({ value }: { value: number }) {
	const length = 2 * Math.PI * 6;
	return (
		<svg viewBox="0 0 16 16" className="size-4 -rotate-90" fill="none" strokeWidth="2" aria-hidden="true">
			<circle cx="8" cy="8" r="6" className="stroke-(--blue-200)" />
			<circle
				cx="8"
				cy="8"
				r="6"
				strokeLinecap="round"
				strokeDasharray={length}
				strokeDashoffset={length * (1 - value)}
				className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-linear"
			/>
		</svg>
	);
}

/** The sidebar's update button. It only exists while a newer version is out. */
export function UpdateIcon({ update }: { update: UpdateInfo | null }) {
	const { step, act, question } = useUpdateAction(update);
	if (step === "none" || !update) return null;
	const version = `Version ${update.latest}`;
	const label = update.openingDownload
		? "Checking the latest release"
		: {
				link: `${version} is available. Download it`,
				download: `${version} is available. Update now`,
				downloading: `Downloading ${version.toLowerCase()}, ${percent(update)}%`,
				restart: `${version} is ready. Restart to update`,
			}[step];
	const look =
		step === "restart"
			? "bg-solid text-on-solid hover:bg-solid-hover hover:text-on-solid"
			: "bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink";

	return (
		<>
			<IconButton
				label={label}
				disabled={update.openingDownload || step === "downloading"}
				aria-disabled={update.openingDownload || step === "downloading" || undefined}
				className={`relative ${look}`}
				onClick={() => void act()}
			>
				{step === "downloading" && <ProgressRing value={update.progress ?? 0} />}
				{step === "restart" && <RotateCw size={14} strokeWidth={2} aria-hidden />}
				{(step === "link" || step === "download") && (
					<>
						<ArrowDownToLine size={15} strokeWidth={2} aria-hidden />
						<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-sunk" />
					</>
				)}
			</IconButton>
			{question}
		</>
	);
}

/** The same steps as a labelled button, for Settings. Nothing is rendered when there is no newer version. */
export function UpdateButton({ update }: { update: UpdateInfo | null }) {
	const { step, act, question } = useUpdateAction(update);
	if (step === "none" || !update) return null;
	if (step === "downloading") {
		// A status, not a button: there is nothing to press until the download is in.
		return (
			<span role="status" className="inline-flex h-7 items-center gap-2 font-medium text-ink-2 tabular-nums">
				<ProgressRing value={update.progress ?? 0} />
				Downloading {percent(update)}%
			</span>
		);
	}
	const restart = step === "restart";
	return (
		<>
			<Button
				size="sm"
				tone="primary"
				disabled={update.openingDownload}
				icon={
					restart ? (
						<RotateCw size={13} strokeWidth={2} aria-hidden />
					) : (
						<ArrowDownToLine size={13} strokeWidth={2} aria-hidden />
					)
				}
				onClick={() => void act()}
			>
				{update.openingDownload
					? "Checking latest release"
					: restart
						? "Restart to update"
						: step === "link"
							? `Download ${update.latest}`
							: `Update to ${update.latest}`}
			</Button>
			{question}
		</>
	);
}
