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
import { useRef, useState } from "react";
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
	if (!update.available) return undefined;
	const version = `Version ${update.latest}`;
	if (update.stage === "failed") {
		return `${update.problem ?? "The update could not be installed."} Download ${version.toLowerCase()} from the site instead.`;
	}
	if (update.stage === "ready") return `${version} is downloaded. The app closes, installs it and opens again.`;
	if (update.stage === "downloading") return `Downloading ${version.toLowerCase()}.`;
	return update.blocked ? `${version} is available. ${update.blocked}` : `${version} is available.`;
}

/** The app looks for a release every few hours. A button brings that up to date unless it is this recent. */
const FRESH_FOR_MS = 60_000;

function useUpdateAction(update: UpdateInfo | null) {
	const [asking, setAsking] = useState(false);
	const acting = useRef(false);
	const step = stepOf(update);
	const restart = () => void window.desk.updates.install();

	/** The pointer reaching the button: a press may follow, so the offer is brought up to date first. */
	const refresh = () => void window.desk.updates.check(FRESH_FOR_MS).catch(() => {});

	const act = async () => {
		if (step === "restart") {
			// A restart stops whatever the agent is in the middle of, so it asks first.
			const agent = await window.desk.agent.state();
			if (agent.status === "idle") restart();
			else setAsking(true);
			return;
		}
		if ((step !== "link" && step !== "download") || acting.current) return;
		acting.current = true;
		try {
			// A release may have come out since the last check, and what is fetched is the newest one.
			// If the site cannot be reached, this is the offer already on the button.
			const latest = await window.desk.updates.check(FRESH_FOR_MS).catch(() => update);
			const now = stepOf(latest);
			if (now === "link" && latest?.url) void window.desk.shell.openExternal(latest.url);
			if (now === "download") void window.desk.updates.download();
		} finally {
			acting.current = false;
		}
	};

	const question = (
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
	);

	return { step, act, refresh, question };
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
	const { step, act, refresh, question } = useUpdateAction(update);
	if (step === "none" || !update) return null;
	const version = `Version ${update.latest}`;
	const label = {
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
				aria-disabled={step === "downloading" || undefined}
				className={`relative ${look}`}
				onPointerEnter={refresh}
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
	const { step, act, refresh, question } = useUpdateAction(update);
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
				icon={
					restart ? (
						<RotateCw size={13} strokeWidth={2} aria-hidden />
					) : (
						<ArrowDownToLine size={13} strokeWidth={2} aria-hidden />
					)
				}
				onPointerEnter={refresh}
				onClick={() => void act()}
			>
				{restart ? "Restart to update" : step === "link" ? `Download ${update.latest}` : `Update to ${update.latest}`}
			</Button>
			{question}
		</>
	);
}
