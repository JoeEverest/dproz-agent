import type { Settings, UpdateInfo, WorkspaceDocument } from "@shared/ipc";
import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import {
	ArrowDownToLine,
	Eye,
	EyeOff,
	FileText,
	KeyRound,
	Pencil,
	Plus,
	ShieldAlert,
	Trash2,
	Upload,
} from "lucide-react";
import { type DragEvent, type FormEvent, type ReactNode, useState } from "react";
import { fileSize, relativeTime } from "../lib/format";
import { useResource } from "../lib/hooks";
import { ApiKeyForm } from "./ApiKeyForm";
import { Markdown } from "./Markdown";
import { PageHeader } from "./PageHeader";
import { Button, Field, IconButton, Input, Notice, Picker, Textarea, Toggle } from "./ui";

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

function DocumentsGroup() {
	const documents = useResource(() => window.desk.documents.list());
	const [over, setOver] = useState(false);
	const list = documents.data ?? [];

	const accept = (next: WorkspaceDocument[]) => {
		const known = new Set(list.map((document) => document.name));
		const added = next.filter((document) => !known.has(document.name)).map((document) => document.name);
		documents.setData(next);
		if (added.length) void window.desk.agent.documentsAdded(added);
	};

	const onDrop = async (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const paths = [...event.dataTransfer.files].map((file) => window.desk.documents.pathForFile(file)).filter(Boolean);
		if (paths.length) accept(await window.desk.documents.add(paths));
	};

	const choose = async () => accept(await window.desk.documents.pick());

	return (
		<Group
			title="Your documents"
			note="Everything the agent holds on you. It reads these to learn about you and tailors a copy for each job. Remove one and it stops using it."
			action={
				<Button size="sm" icon={<Plus size={13} strokeWidth={2} aria-hidden />} onClick={() => void choose()}>
					Add documents
				</Button>
			}
		>
			{list.length > 0 && (
				<ul>
					{list.map((document) => (
						<li key={document.name} className="flex items-center gap-3 border-b border-line py-2.5 pr-2.5 pl-4">
							<IconTile>
								<FileText size={15} strokeWidth={1.75} aria-hidden />
							</IconTile>
							<div className="min-w-0 flex-1">
								<p className="selectable truncate font-medium">{document.name}</p>
								<p className="text-xs text-ink-3 tabular-nums">
									{fileSize(document.sizeBytes)} · added {relativeTime(document.modifiedAt)}
								</p>
							</div>
							<IconButton
								label={`Remove ${document.name}`}
								className="hover:bg-danger-wash hover:text-danger"
								onClick={async () => documents.setData(await window.desk.documents.remove(document.name))}
							>
								<Trash2 size={14} strokeWidth={1.75} aria-hidden />
							</IconButton>
						</li>
					))}
				</ul>
			)}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; the Add documents button covers keyboard and pointer use */}
			<div
				onDragOver={(event) => {
					event.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(event) => void onDrop(event)}
				className={`m-2 flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-ink-3 transition-[background-color,border-color] duration-150 ${
					over ? "border-accent bg-accent-wash text-accent-ink" : "border-line-strong"
				}`}
			>
				<Upload size={14} strokeWidth={1.75} aria-hidden />
				<p>
					{list.length === 0 ? "No documents yet. " : ""}Drop a resume, certificate, reference, transcript or old cover
					letter here.
				</p>
			</div>
		</Group>
	);
}

function AboutGroup() {
	const profile = useResource(() => window.desk.profile.read(), ["agent:state"]);
	const [draft, setDraft] = useState<string | null>(null);
	const text = (profile.data ?? "").trim();

	const save = async () => {
		if (draft === null) return;
		await window.desk.profile.write(draft);
		profile.setData(draft);
		setDraft(null);
	};

	return (
		<Group
			title="What the agent knows about you"
			note="Its memory of you, built from your documents and your answers. Every application is written from this, so correct anything that is wrong."
			action={
				draft === null ? (
					<Button
						size="sm"
						icon={<Pencil size={12} strokeWidth={1.75} aria-hidden />}
						onClick={() => setDraft(profile.data ?? "")}
					>
						Edit
					</Button>
				) : (
					<div className="flex gap-2">
						<Button size="sm" tone="quiet" onClick={() => setDraft(null)}>
							Cancel
						</Button>
						<Button size="sm" tone="primary" onClick={() => void save()}>
							Save
						</Button>
					</div>
				)
			}
		>
			{draft !== null ? (
				<Textarea
					aria-label="What the agent knows about you"
					className="block max-h-[420px] min-h-[240px] rounded-xl border-transparent px-4 py-3"
					rows={12}
					autoResize
					value={draft}
					onValueChange={(value) => setDraft(value)}
				/>
			) : text ? (
				<div className="scroll-quiet max-h-[300px] overflow-y-auto px-4 py-3">
					<Markdown>{text}</Markdown>
				</div>
			) : (
				<p className="px-4 py-4 text-ink-3">Nothing yet. The agent writes this once it has read your documents.</p>
			)}
		</Group>
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
			note="Accounts on job sites. The agent signs in with these and saves its own when a site makes it register. Passwords are encrypted on this computer."
			action={
				!adding && (
					<Button size="sm" icon={<Plus size={13} strokeWidth={2} aria-hidden />} onClick={() => setAdding(true)}>
						Add a login
					</Button>
				)
			}
		>
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

function AgentGroup({ settings, onChange }: Props) {
	const setup = useResource(() => window.desk.setup.status());
	const update = async (patch: Partial<Settings>) => onChange(await window.desk.settings.update(patch));
	const claude = setup.data?.claude;
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
			{claude?.signedIn && (
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
			)}
		</Group>
	);
}

function AccountGroup() {
	const setup = useResource(() => window.desk.setup.status());
	const [adding, setAdding] = useState(false);
	const status = setup.data;
	const claude = status?.claude;
	const usingKey = Boolean(status?.apiKey.set);
	const showForm = adding || Boolean(claude && !claude.signedIn && !usingKey);

	const title = !status
		? "Checking"
		: usingKey
			? `API key ending in ${status.apiKey.hint}`
			: claude?.signedIn
				? "Claude Code sign-in"
				: "Not signed in";
	const note = !status
		? "Looking for a Claude sign-in on this computer."
		: usingKey
			? "The agent's work is billed to this key. It is stored encrypted on this computer."
			: claude?.signedIn
				? `Signed in${claude.email ? ` as ${claude.email}` : ""}. The agent runs on this account.`
				: claude?.reason;

	return (
		<Group
			title="Claude account"
			note="The agent runs on your own Claude: either the Claude Code sign-in on this computer, or an Anthropic API key."
		>
			<Row
				title={title}
				note={note}
				control={
					usingKey ? (
						<Button size="sm" tone="danger" onClick={async () => setup.setData(await window.desk.claude.clearApiKey())}>
							Remove key
						</Button>
					) : (
						!showForm && (
							<Button size="sm" onClick={() => setAdding(true)}>
								Use an API key instead
							</Button>
						)
					)
				}
			/>
			{showForm && !usingKey && (
				<div className="px-4 py-3.5">
					<p className="mb-2 text-xs text-ink-3">
						Paste a key from the Anthropic Console. It is checked, then stored encrypted on this computer.
					</p>
					<ApiKeyForm
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

function AboutAppGroup({ update }: { update: UpdateInfo | null }) {
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
		: update.available
			? `Version ${update.latest} is available.`
			: update.error
				? "The last check for a new version did not get through."
				: update.checkedAt
					? `You have the latest version. Checked ${relativeTime(update.checkedAt)}.`
					: "It checks for a new version every few hours.";

	return (
		<Group title="About">
			<Row
				title={`Dproz Agent ${update?.current ?? ""}`}
				note={note}
				control={
					update?.available && update.url ? (
						<Button
							size="sm"
							tone="primary"
							icon={<ArrowDownToLine size={13} strokeWidth={2} aria-hidden />}
							onClick={() => update.url && void window.desk.shell.openExternal(update.url)}
						>
							Download {update.latest}
						</Button>
					) : (
						<Button size="sm" disabled={checking} onClick={() => void check()}>
							{checking ? "Checking" : "Check for updates"}
						</Button>
					)
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

export function ProfilePage() {
	return (
		<Page title="Profile settings">
			<DocumentsGroup />
			<AboutGroup />
			<LoginsGroup />
		</Page>
	);
}

export function SettingsPage({ settings, onChange, update }: Props & { update: UpdateInfo | null }) {
	return (
		<Page title="Settings">
			<AgentGroup settings={settings} onChange={onChange} />
			<AccountGroup />
			<AboutAppGroup update={update} />
		</Page>
	);
}
