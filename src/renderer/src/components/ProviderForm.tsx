import type { EndpointModels, SetupStatus } from "@shared/ipc";
import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button, Field, Input, Picker } from "./ui";

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
			aria-pressed={current === value}
			onClick={() => onPick(value)}
			className="pressable flat h-6 rounded-[5px] px-2.5 text-xs font-medium text-ink-2 hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-card"
		>
			{children}
		</button>
	);
}

const OTHER = "\u0000other";

type ModelChoiceProps = {
	offered: EndpointModels | null;
	value: string;
	onChange: (model: string) => void;
	className?: string;
	/** Report a typed name only when the user leaves the field or presses Enter. */
	commitOnBlur?: boolean;
};

/** A picker of the models an endpoint offers, with a way to type any other name. */
export function ModelChoice({ offered, value, onChange, className = "", commitOnBlur = false }: ModelChoiceProps) {
	const [typing, setTyping] = useState(false);
	const [draft, setDraft] = useState(value);
	const listed = [...(offered?.models ?? []), ...(offered?.cloud ?? [])];

	if (typing || listed.length === 0) {
		return (
			<div className={`flex items-center gap-2 ${className}`}>
				<Input
					aria-label="Model"
					value={commitOnBlur ? draft : value}
					onValueChange={(model) => (commitOnBlur ? setDraft(model) : onChange(model))}
					onBlur={() => commitOnBlur && onChange(draft)}
					onKeyDown={(event) => {
						if (commitOnBlur && event.key === "Enter") onChange(draft);
					}}
					placeholder="qwen3.5"
					autoComplete="off"
					spellCheck={false}
				/>
				{listed.length > 0 && (
					<Button size="sm" tone="quiet" onClick={() => setTyping(false)}>
						Pick from the list
					</Button>
				)}
			</div>
		);
	}

	const options = [
		...(value && !listed.includes(value) ? [{ value, label: value }] : []),
		...(offered?.models ?? []).map((model) => ({ value: model, label: model })),
		...(offered?.cloud ?? []).map((model) => ({ value: model, label: `${model.replace(/[:-]cloud$/, "")} · cloud` })),
		{ value: OTHER, label: "Type a name…" },
	];

	return (
		<Picker
			label="Model"
			value={value || options[0].value}
			options={options}
			onChange={(model) => {
				if (model === OTHER) setTyping(true);
				else onChange(model);
			}}
			className={`w-full ${className}`}
		/>
	);
}

const presets = [
	{ label: "Ollama on this computer", baseUrl: "http://localhost:11434" },
	{ label: "Ollama Cloud", baseUrl: "https://ollama.com" },
];

/** Lets the user run the agent on an Anthropic API key or on another Anthropic-compatible endpoint. */
export function ProviderForm({ onSaved, onCancel }: Props) {
	const [kind, setKind] = useState<Kind>("api-key");
	const [key, setKey] = useState("");
	const [endpoint, setEndpoint] = useState({ baseUrl: "", model: "", token: "" });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [offered, setOffered] = useState<EndpointModels | null>(null);
	const onOllamaCloud = /^https?:\/\/(www\.)?ollama\.com/i.test(endpoint.baseUrl.trim());

	// Ask the address what models it has, a moment after the user stops typing.
	useEffect(() => {
		const baseUrl = endpoint.baseUrl.trim();
		if (kind !== "endpoint" || !baseUrl) {
			setOffered(null);
			return;
		}
		let current = true;
		const timer = setTimeout(async () => {
			const found = await window.desk.claude
				.endpointModels({ baseUrl, token: endpoint.token || undefined })
				.catch(() => null);
			if (!current) return;
			setOffered(found);
			const first = found?.models[0] ?? found?.cloud[0];
			if (first) setEndpoint((now) => (now.model ? now : { ...now, model: first }));
		}, 500);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [kind, endpoint.baseUrl, endpoint.token]);

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
			<fieldset className="m-0 inline-flex min-w-0 gap-0.5 self-start rounded-md border-0 bg-fill-hover p-0.5">
				<legend className="sr-only">How to connect</legend>
				<Choice current={kind} value="api-key" onPick={pick}>
					Anthropic API key
				</Choice>
				<Choice current={kind} value="endpoint" onPick={pick}>
					Another endpoint
				</Choice>
			</fieldset>

			{kind === "api-key" ? (
				<Secret value={key} onChange={setKey} label="Anthropic API key" placeholder="sk-ant-…" />
			) : (
				<>
					<p className="text-xs text-ink-3">
						Any server that speaks the Anthropic Messages API: a gateway, or Ollama for open-weight models. Models other
						than Claude are not supported by Anthropic and may handle this work poorly; pick one that supports tools,
						with a context of at least 64k.
					</p>
					<div className="flex flex-wrap gap-1.5">
						{presets.map((preset) => (
							<Button
								key={preset.baseUrl}
								size="sm"
								onClick={() => {
									setError(null);
									setEndpoint((current) => ({ ...current, baseUrl: preset.baseUrl, model: "" }));
								}}
							>
								{preset.label}
							</Button>
						))}
					</div>
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
						<Field
							label="Model"
							hint={
								!endpoint.baseUrl.trim() || !offered
									? undefined
									: !offered.reachable
										? "Nothing answered at that address yet."
										: offered.cloud.length > 0
											? "Cloud models need `ollama signin` on this computer first."
											: offered.models.length === 0
												? "That address does not list its models; type the name."
												: undefined
							}
						>
							<ModelChoice
								offered={offered}
								value={endpoint.model}
								onChange={(model) => setEndpoint((current) => ({ ...current, model }))}
							/>
						</Field>
					</div>
					<Field label={onOllamaCloud ? "Ollama API key" : "Token (leave empty for Ollama on this computer)"}>
						<Secret
							value={endpoint.token}
							onChange={(token) => setEndpoint((current) => ({ ...current, token }))}
							label="Token"
							placeholder={onOllamaCloud ? "From ollama.com, Settings, Keys" : "Optional"}
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
