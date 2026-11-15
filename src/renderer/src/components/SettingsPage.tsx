import type { Settings, SetupStatus, UpdateInfo } from "@shared/ipc";
import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { Eye, EyeOff, Globe, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useAgentState } from "../lib/agent";
import { relativeTime } from "../lib/format";
import { useResource } from "../lib/hooks";
import { PageHeader } from "./PageHeader";
import { ModelChoice, ProviderForm } from "./ProviderForm";
import { UpdateButton, updateNote } from "./UpdateControl";
import { Button, Field, IconButton, Input, Notice, Picker, Toggle } from "./ui";

type GroupProps = { title: string; note?: string; action?: ReactNode; children: ReactNode };

function Group({ title, note, action, children }: GroupProps) {
	return (
		<section aria-label={title} className="mt-9 first:mt-0">
			<div className="mb-2.5 flex items-end justify-between gap-6">
				<div className="min-w-0">
					<h2 className="text-sm font-semibold">{title}</h2>
					{note && <p className="mt-0.5 max-w-[60ch] text-ink-3">{note}</p>}
				</div>
				{action && <div className="shrink-0">{action}</div>}
			</div>
			<div className="rounded-xl border border-line bg-surface">{children}</div>
		</section>
	);
}

function Row({ title, note, control }: { title: string; note?: string; control: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-8 border-b border-line px-4 py-3.5 last:border-b-0">
			<div className="min-w-0">
				<p className="font-medium">{title}</p>
				{note && <p className="mt-0.5 max-w-[48ch] text-xs text-ink-3">{note}</p>}
			</div>
			<div className="shrink-0">{control}</div>
		</div>
	);
}

function IconTile({ children }: { children: ReactNode }) {
	return (
		<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-fill-hover text-ink-2">
			{children}
		</span>
	);
}

const emptyLogin = { site: "", username: "", password: "" };

function LoginsGroup() {
	const credentials = useResource(() => window.desk.credentials.list());
	const setup = useResource(() => window.desk.setup.status());
	const [adding, setAdding] = useState(false);
	const [form, setForm] = useState(emptyLogin);
	const [error, setError] = useState<string | null>(null);
	const update = (field: keyof typeof emptyLogin) => (value: string) =>
		setForm((current) => ({ ...current, [field]: value }));
	const list = credentials.data ?? [];
	const storage = setup.data?.credentialStorage;
	const complete = Boolean(form.site.trim() && form.username.trim() && form.password);
	const agent = useAgentState();
	const [browserNote, setBrowserNote] = useState<string | null>(null);

	const openBrowser = async () => {
		const opened = await window.desk.browser.open();
		setBrowserNote(opened.ok ? null : opened.reason);
	};

	const save = async (event: FormEvent) => {
		event.preventDefault();
		try {
			credentials.setData(await window.desk.credentials.save(form));
			setForm(emptyLogin);
			setError(null);
			setAdding(false);
		} catch (cause) {
			setError(`The login was not saved: ${(cause as Error).message}`);
		}
	};

	return (
		<Group
			title="Site logins"
			note="How the agent gets into your accounts: sign in yourself in its browser, or save a login for it to use. It saves its own when a site makes it register. Passwords are encrypted on this computer."
			action={
				!adding && (
					<Button size="sm" icon={<Plus size={13} strokeWidth={2} aria-hidden />} onClick={() => setAdding(true)}>
						Add a login
					</Button>
				)
			}
		>
			<Row
				title="The agent's browser"
				note={
					browserNote ??
					(agent.browserOpen
						? "Open now. The agent waits until you close it, then finds itself signed in."
						: "Sign in to your email and job sites here once. The agent uses this same browser, so it stays signed in and can pick up the codes sites email you.")
				}
				control={
					agent.browserOpen ? (
						<Button size="sm" onClick={() => void window.desk.browser.close()}>
							Close browser
						</Button>
					) : (
						<Button
							size="sm"
							icon={<Globe size={13} strokeWidth={1.75} aria-hidden />}
							onClick={() => void openBrowser()}
						>
							Open browser
						</Button>
					)
				}
			/>
			{storage && !storage.encrypted && (
				<div className="border-b border-line p-2">
					<Notice tone="attention" icon={<ShieldAlert size={16} strokeWidth={1.75} aria-hidden />}>
						This computer has no system keyring available ({storage.backend}), so saved passwords are only lightly
						protected on disk. Install and unlock GNOME Keyring or KWallet, then restart the app.
					</Notice>
				</div>
			)}
			{list.length === 0 && !adding && <p className="px-4 py-4 text-ink-3">No logins saved yet.</p>}
			{list.length > 0 && (
				<ul>
					{list.map((credential) => (
						<li
							key={credential.site}
							className="flex items-center gap-3 border-b border-line py-2.5 pr-2.5 pl-4 last:border-b-0"
						>
							<IconTile>
								<KeyRound size={15} strokeWidth={1.75} aria-hidden />
							</IconTile>
							<div className="min-w-0 flex-1">
								<p className="selectable truncate font-medium">{credential.site}</p>
								<p className="selectable truncate text-xs text-ink-3">{credential.username}</p>
							</div>
							<span className="shrink-0 text-xs text-ink-3 tabular-nums">
								Saved {relativeTime(credential.updatedAt)}
							</span>
							<IconButton
								label={`Delete the login for ${credential.site}`}
								className="hover:bg-danger-wash hover:text-danger"
								onClick={async () => credentials.setData(await window.desk.credentials.remove(credential.site))}
							>
								<Trash2 size={14} strokeWidth={1.75} aria-hidden />
							</IconButton>
						</li>
					))}
				</ul>
			)}
			{adding && (
				<form
					onSubmit={(event) => void save(event)}
					className={`grid grid-cols-2 gap-x-3 gap-y-3 p-4 ${list.length > 0 ? "border-t border-line" : ""}`}
				>
					<div className="col-span-2">
						<Field label="Site">
							<Input
								value={form.site}
								onValueChange={update("site")}
								placeholder="linkedin.com"
								autoComplete="off"
								spellCheck={false}
								autoFocus
							/>
						</Field>
					</div>
					<Field label="Email or username">
						<Input value={form.username} onValueChange={update("username")} autoComplete="off" spellCheck={false} />
					</Field>
					<Field label="Password">
						<PasswordInput
							value={form.password}
							onValueChange={update("password")}
							autoComplete="new-password"
							className="flex h-8 w-full items-center rounded-md border border-line-strong bg-surface pr-0.5 transition-[border-color] duration-150 focus-within:border-accent hover:border-ink-3"
						>
							<PasswordInputControl className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-ink outline-none" />
							<PasswordInputToggle
								aria-label="Show password"
								className="pressable flex size-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-fill-hover hover:text-ink"
							>
								{(state) =>
									state.visible ? (
										<EyeOff size={14} strokeWidth={1.75} aria-hidden />
									) : (
										<Eye size={14} strokeWidth={1.75} aria-hidden />
									)
								}
							</PasswordInputToggle>
						</PasswordInput>
					</Field>
					{error && (
						<p role="alert" className="col-span-2 text-danger">
							{error}
						</p>
					)}
					<div className="col-span-2 flex justify-end gap-2">
						<Button
							size="sm"
							tone="quiet"
							onClick={() => {
								setAdding(false);
								setForm(emptyLogin);
								setError(null);
							}}
						>
							Cancel
						</Button>
						<Button type="submit" size="sm" tone="primary" disabled={!complete}>
							Save login
						</Button>
					</div>
				</form>
			)}
		</Group>
	);
}

const schedules = [
	{ value: "4", label: "Every 4 hours" },
	{ value: "6", label: "Every 6 hours" },
	{ value: "12", label: "Twice a day" },
	{ value: "24", label: "Once a day" },
] as const;

const DEFAULT_MODEL = "default";

function modelOptions(models: { value: string; label: string }[]) {
	const hasDefault = models.some((model) => model.value === DEFAULT_MODEL);
	return hasDefault ? models : [{ value: DEFAULT_MODEL, label: "Claude Code default" }, ...models];
}

type Props = { settings: Settings; onChange: (settings: Settings) => void };

type SetupResource = { data: SetupStatus | undefined; setData: (status: SetupStatus) => void };

function AgentGroup({ settings, onChange, setup }: Props & { setup: SetupResource }) {
	const update = async (patch: Partial<Settings>) => onChange(await window.desk.settings.update(patch));
	const claude = setup.data?.claude;
	const connection = setup.data?.connection;
	const schedule = schedules.some((option) => option.value === String(settings.sweepIntervalHours))
		? (String(settings.sweepIntervalHours) as (typeof schedules)[number]["value"])
		: "6";

	return (
		<Group title="Agent">
			<Row
				title="Send applications automatically"
				note="On: each application is sent once it has been prepared and judged. Off: it waits at Ready to submit until you send it from its card."
				control={
					<Toggle
						label="Send applications automatically"
						checked={settings.autoSubmit}
						onChange={(autoSubmit) => void update({ autoSubmit })}
					/>
				}
			/>
			<Row
				title="How often it looks for jobs"
				note="Each search covers what has been posted since the last one. It runs while the app is open, including with the window closed."
				control={
					<Picker
						label="How often it looks for jobs"
						value={schedule}
						options={schedules}
						onChange={(hours) => void update({ sweepIntervalHours: Number(hours) })}
						className="w-[148px]"
					/>
				}
			/>
			{connection?.kind === "custom" ? (
				<EndpointModelRow model={connection.model} setup={setup} />
			) : (
				claude?.signedIn && (
					<Row
						title="Model"
						note="The model the agent and its helpers think with."
						control={
							<Picker
								label="Model"
								value={settings.model || DEFAULT_MODEL}
								options={modelOptions(claude.models)}
								onChange={(model) => void update({ model: model === DEFAULT_MODEL ? "" : model })}
								className="w-[188px]"
							/>
						}
					/>
				)
			)}
		</Group>
	);
}

function EndpointModelRow({ model, setup }: { model: string; setup: SetupResource }) {
	const offered = useResource(() => window.desk.claude.endpointModels());
	const [changing, setChanging] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const change = async (next: string) => {
		if (!next.trim() || next === model) return;
		setChanging(true);
		setError(null);
		try {
			setup.setData(await window.desk.claude.setEndpointModel(next));
		} catch (cause) {
			setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
		} finally {
			setChanging(false);
		}
	};

	return (
		<Row
			title="Model"
			note={error ?? (changing ? "Checking that the endpoint can run it." : "One of the models your endpoint offers.")}
			control={
				<ModelChoice
					key={model}
					commitOnBlur
					offered={offered.data ?? null}
					value={model}
					onChange={(next) => void change(next)}
					className="w-[220px]"
				/>
			}
		/>
	);
}

function ProviderGroup({ setup }: { setup: SetupResource }) {
	const [adding, setAdding] = useState(false);
	const status = setup.data;
	const claude = status?.claude;
	const connection = status?.connection;
	const ownConnection = connection && connection.kind !== "claude-code";
	const showForm = !ownConnection && (adding || Boolean(claude && !claude.signedIn));

	const title = !connection
		? "Checking"
		: connection.kind === "api-key"
			? `Anthropic API key ending in ${connection.hint}`
			: connection.kind === "custom"
				? `${connection.model} at ${connection.baseUrl}`
				: claude?.signedIn
					? "Claude Code sign-in"
					: "Not connected";
	const note = !connection
		? "Looking for a Claude sign-in on this computer."
		: connection.kind === "api-key"
			? "The agent's work is billed to this key. It is stored encrypted on this computer."
			: connection.kind === "custom"
				? `The agent's model requests go to this address${connection.hasToken ? ", with your token" : ""}, not to Anthropic.`
				: claude?.signedIn
					? `Signed in${claude.email ? ` as ${claude.email}` : ""}. The agent runs on this account.`
					: claude?.reason;

	return (
		<Group
			title="Model provider"
			note="What the agent thinks with: the Claude Code sign-in on this computer, an Anthropic API key, or another endpoint such as Ollama."
		>
			<Row
				title={title}
				note={note}
				control={
					ownConnection ? (
						<Button
							size="sm"
							tone="danger"
							onClick={async () => setup.setData(await window.desk.claude.clearConnection())}
						>
							Remove
						</Button>
					) : (
						!showForm && (
							<Button size="sm" onClick={() => setAdding(true)}>
								Use something else
							</Button>
						)
					)
				}
			/>
			{showForm && (
				<div className="px-4 py-3.5">
					<ProviderForm
						onSaved={(next) => {
							setup.setData(next);
							setAdding(false);
						}}
						onCancel={adding ? () => setAdding(false) : undefined}
					/>
				</div>
			)}
		</Group>
	);
}

function AboutAppGroup({ settings, onChange, update }: Props & { update: UpdateInfo | null }) {
	const [checking, setChecking] = useState(false);

	const check = async () => {
		setChecking(true);
		try {
			await window.desk.updates.check();
		} finally {
			setChecking(false);
		}
	};

	const note = !update
		? ""
		: (updateNote(update) ??
			(update.error
				? "The last check for a new version did not get through."
				: update.checkedAt
					? `You have the latest version. Checked ${relativeTime(update.checkedAt)}.`
					: "It checks for a new version every few hours."));

	return (
		<Group title="About">
			<Row
				title={`Dproz Agent ${update?.current ?? ""}`}
				note={note}
				control={
					update?.available ? (
						<UpdateButton update={update} />
					) : (
						<Button size="sm" disabled={checking} onClick={() => void check()}>
							{checking ? "Checking" : "Check for updates"}
						</Button>
					)
				}
			/>
			<Row
				title="Share anonymous usage figures"
				note="Which models are used, what a run costs, and how far each application gets and through which website. Never your name, your documents, your answers, or which jobs and employers."
				control={
					<Toggle
						label="Share anonymous usage figures"
						checked={settings.shareUsage}
						onChange={async (shareUsage) => onChange(await window.desk.settings.update({ shareUsage }))}
					/>
				}
			/>
		</Group>
	);
}

function Page({ title, children }: { title: string; children: ReactNode }) {
	return (
		<>
			<PageHeader title={title} />
			<div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[680px] px-6 pt-8 pb-16">{children}</div>
			</div>
		</>
	);
}

export function SettingsPage({ settings, onChange, update }: Props & { update: UpdateInfo | null }) {
	const setup = useResource(() => window.desk.setup.status());
	return (
		<Page title="Settings">
			<AgentGroup settings={settings} onChange={onChange} setup={setup} />
			<LoginsGroup />
			<ProviderGroup setup={setup} />
			<AboutAppGroup settings={settings} onChange={onChange} update={update} />
		</Page>
	);
}
