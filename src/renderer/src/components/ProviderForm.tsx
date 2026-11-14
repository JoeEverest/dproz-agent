import type { SetupStatus } from "@shared/ipc";
import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button, Field, Input } from "./ui";

type Kind = "api-key" | "endpoint";
type Props = { onSaved: (status: SetupStatus) => void; onCancel?: () => void };

const clean = (cause: unknown) =>
	(cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function Secret({
	value,
	onChange,
	label,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder: string;
}) {
	return (
		<PasswordInput
			value={value}
			onValueChange={(next) => onChange(next)}
			autoComplete="off"
			className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-line-strong bg-surface pr-0.5 transition-[border-color] duration-150 focus-within:border-accent hover:border-ink-3"
		>
			<PasswordInputControl
				aria-label={label}
				placeholder={placeholder}
				spellCheck={false}
				className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-4"
			/>
			<PasswordInputToggle
				aria-label={`Show the ${label.toLowerCase()}`}
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
	);
}

function Choice({
	current,
	value,
	onPick,
	children,
}: {
	current: Kind;
	value: Kind;
	onPick: (kind: Kind) => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={current === value}
			onClick={() => onPick(value)}
			className="pressable flat h-6 rounded-[5px] px-2.5 text-xs font-medium text-ink-2 hover:text-ink aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-card"
		>
			{children}
		</button>
	);
}

/** Lets the user run the agent on an Anthropic API key or on another Anthropic-compatible endpoint. */
export function ProviderForm({ onSaved, onCancel }: Props) {
	const [kind, setKind] = useState<Kind>("api-key");
	const [key, setKey] = useState("");
	const [endpoint, setEndpoint] = useState({ baseUrl: "", model: "", token: "" });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const ready = kind === "api-key" ? Boolean(key.trim()) : Boolean(endpoint.baseUrl.trim() && endpoint.model.trim());

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (!ready) return;
		setSaving(true);
		setError(null);
		try {
			onSaved(
				kind === "api-key"
					? await window.desk.claude.setApiKey(key)
					: await window.desk.claude.setEndpoint({ ...endpoint, token: endpoint.token || undefined }),
			);
		} catch (cause) {
			setError(clean(cause));
		} finally {
			setSaving(false);
		}
	};

	const pick = (next: Kind) => {
		setKind(next);
		setError(null);
	};

	return (
		<form onSubmit={(event) => void save(event)} className="app flex flex-col gap-3 font-sans">
			<div
				role="radiogroup"
				aria-label="How to connect"
				className="inline-flex gap-0.5 self-start rounded-md bg-fill-hover p-0.5"
			>
				<Choice current={kind} value="api-key" onPick={pick}>
					Anthropic API key
				</Choice>
				<Choice current={kind} value="endpoint" onPick={pick}>
					Another endpoint
				</Choice>
			</div>

			{kind === "api-key" ? (
				<Secret value={key} onChange={setKey} label="Anthropic API key" placeholder="sk-ant-…" />
			) : (
				<>
					<p className="text-xs text-ink-3">
						Any server that speaks the Anthropic Messages API: a gateway, or Ollama for open-weight models. Models other
						than Claude are not supported by Anthropic and may handle this work poorly; pick one that supports tools,
						with a context of at least 64k.
					</p>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Address">
							<Input
								value={endpoint.baseUrl}
								onValueChange={(baseUrl) => setEndpoint((current) => ({ ...current, baseUrl }))}
								placeholder="http://localhost:11434"
								autoComplete="off"
								spellCheck={false}
							/>
						</Field>
						<Field label="Model">
							<Input
								value={endpoint.model}
								onValueChange={(model) => setEndpoint((current) => ({ ...current, model }))}
								placeholder="qwen3.5"
								autoComplete="off"
								spellCheck={false}
							/>
						</Field>
					</div>
					<Field label="Token (leave empty for a local Ollama)">
						<Secret
							value={endpoint.token}
							onChange={(token) => setEndpoint((current) => ({ ...current, token }))}
							label="Token"
							placeholder="Optional"
						/>
					</Field>
				</>
			)}

			{error && (
				<p role="alert" className="selectable text-danger">
					{error}
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button type="submit" size="sm" tone="primary" disabled={!ready || saving}>
					{saving ? "Checking" : kind === "api-key" ? "Use this key" : "Use this endpoint"}
				</Button>
				{onCancel && (
					<Button size="sm" tone="quiet" onClick={onCancel}>
						Cancel
					</Button>
				)}
				{saving && kind === "endpoint" && (
					<span className="text-xs text-ink-3">Sending a one-word test. A local model can take a minute to load.</span>
				)}
			</div>
		</form>
	);
}
