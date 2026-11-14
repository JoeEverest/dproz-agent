import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useDeskEvent, useResource } from "../lib/hooks";
import { ApiKeyForm } from "./ApiKeyForm";
import { DocumentsPanel } from "./Documents";
import { DprozLogo } from "./DprozLogo";
import { Button } from "./ui";

type StepState = "done" | "todo" | "working" | "problem";

function Step({ state, title, children }: { state: StepState; title: string; children: ReactNode }) {
	return (
		<li className="grid grid-cols-[28px_1fr] gap-x-3 border-t border-line py-5 first:border-t-0">
			<span
				className={`mt-0.5 flex size-5 items-center justify-center rounded-full ${
					state === "done" ? "bg-sent text-canvas" : state === "problem" ? "text-danger" : "text-ink-3"
				}`}
			>
				{state === "done" && <Check size={12} strokeWidth={3} aria-label="Done" />}
				{state === "working" && (
					<LoaderCircle size={16} className="animate-spin [animation-duration:0.7s]" aria-label="In progress" />
				)}
				{state === "problem" && <CircleAlert size={18} strokeWidth={1.75} aria-label="Needs attention" />}
				{state === "todo" && <span className="size-2 rounded-full border-[1.5px] border-ink-3" />}
			</span>
			<div className="min-w-0">
				<h2 className="text-sm font-semibold">{title}</h2>
				<div className="mt-1 text-sm text-ink-2">{children}</div>
			</div>
		</li>
	);
}

export function Onboarding({ onDone }: { onDone: () => Promise<void> }) {
	const setup = useResource(() => window.desk.setup.status());
	const documents = useResource(() => window.desk.documents.list());
	const [installing, setInstalling] = useState(false);
	const [progress, setProgress] = useState("");
	const [installError, setInstallError] = useState<string | null>(null);

	useDeskEvent("setup:browser-progress", ({ line }) => setProgress(line));

	// biome-ignore lint/correctness/useExhaustiveDependencies: poll the document list while this screen is open
	useEffect(() => {
		const timer = setInterval(() => void documents.refresh(), 1500);
		return () => clearInterval(timer);
	}, []);

	const status = setup.data;
	const claude = status?.claude;

	const installBrowser = async () => {
		setInstalling(true);
		setInstallError(null);
		try {
			await window.desk.setup.installBrowser();
		} catch (cause) {
			setInstallError((cause as Error).message);
		} finally {
			setInstalling(false);
			await setup.refresh();
		}
	};

	const start = async () => {
		await window.desk.settings.update({ onboarded: true });
		await window.desk.agent.onboard();
		await onDone();
	};

	const hasDocuments = (documents.data?.length ?? 0) > 0;
	const ready = Boolean(claude?.signedIn && status?.browserInstalled);

	return (
		<div className="scroll-quiet drag-region h-full overflow-y-auto bg-canvas font-(family-name:--font-setup)">
			<div className="no-drag enter-staged mx-auto max-w-[580px] px-8 pt-16 pb-16">
				<div>
					<DprozLogo className="mb-6 h-8 w-auto text-(--logo)" />
					<h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance">
						Set up your job-search agent
					</h1>
					<p className="mt-2 max-w-[56ch] text-sm text-ink-2">
						Give it your resume and it does the rest. It looks for jobs a few times a day, writes a resume and cover
						letter for each good match, applies in its own browser, and keeps a board of everything it sent.
					</p>
				</div>

				<ol className="mt-8">
					<Step state={hasDocuments ? "done" : "todo"} title="Your documents">
						<p className="mb-3">
							Your resume, plus anything an application might ask for: certificates, references, transcripts, a cover
							letter you have sent before.
						</p>
						<DocumentsPanel />
					</Step>

					<Step state={!claude ? "working" : claude.signedIn ? "done" : "problem"} title="Claude">
						{!claude && <p>Checking that Claude Code is signed in on this computer…</p>}
						{claude?.signedIn && claude.method === "api-key" && (
							<p className="selectable">
								Using your API key ending in {status?.apiKey.hint}. The agent's work is billed to that key.
							</p>
						)}
						{claude?.signedIn && claude.method === "claude-code" && (
							<p className="selectable">
								Signed in to Claude Code{claude.email ? ` as ${claude.email}` : ""}. The agent runs on this account.
							</p>
						)}
						{claude && !claude.signedIn && (
							<>
								<p className="selectable text-danger">{claude.reason}</p>
								<p className="mt-1">
									Open a terminal, run{" "}
									<code className="rounded bg-fill-hover px-1 font-mono text-xs text-ink">claude</code>, sign in, then
									check again.
								</p>
								<Button className="mt-3" onClick={() => void setup.refresh()}>
									Check again
								</Button>
								<p className="mt-5 mb-2">Or use an Anthropic API key instead:</p>
								<div className="font-sans">
									<ApiKeyForm onSaved={(next) => setup.setData(next)} />
								</div>
							</>
						)}
					</Step>

					<Step
						state={status?.browserInstalled ? "done" : installing ? "working" : installError ? "problem" : "todo"}
						title="The agent's browser"
					>
						{status?.browserInstalled ? (
							<p>Installed. It keeps its own logins, separate from your everyday browser.</p>
						) : (
							<>
								<p>A private copy of Chromium that the agent drives to fill in applications. About 170 MB.</p>
								{installing && (
									<p className="mt-2 truncate font-mono text-xs text-ink-3 tabular-nums">
										{progress || "Starting the download…"}
									</p>
								)}
								{installError && (
									<p role="alert" className="selectable mt-2 text-danger">
										The download failed: {installError}
									</p>
								)}
								<Button
									className="mt-3"
									tone="primary"
									disabled={installing || !status}
									onClick={() => void installBrowser()}
								>
									{installing ? "Downloading…" : installError ? "Try again" : "Download browser"}
								</Button>
							</>
						)}
					</Step>
				</ol>

				<div className="mt-2 flex items-center gap-4 border-t border-line pt-6">
					<Button tone="primary" disabled={!ready || !hasDocuments} onClick={() => void start()}>
						Start
					</Button>
					<p className="text-sm text-ink-3">It reads your documents first, then starts searching on its own.</p>
				</div>
			</div>
		</div>
	);
}
