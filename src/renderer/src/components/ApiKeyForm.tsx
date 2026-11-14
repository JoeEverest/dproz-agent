import type { SetupStatus } from "@shared/ipc";
import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "./ui";

type Props = { onSaved: (status: SetupStatus) => void; onCancel?: () => void };

export function ApiKeyForm({ onSaved, onCancel }: Props) {
	const [key, setKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (!key.trim()) return;
		setSaving(true);
		setError(null);
		try {
			onSaved(await window.desk.claude.setApiKey(key));
			setKey("");
		} catch (cause) {
			setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={(event) => void save(event)} className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<PasswordInput
					value={key}
					onValueChange={(value) => setKey(value)}
					autoComplete="off"
					className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-line-strong bg-surface pr-0.5 transition-[border-color] duration-150 focus-within:border-accent hover:border-ink-3"
				>
					<PasswordInputControl
						aria-label="Anthropic API key"
						placeholder="sk-ant-…"
						spellCheck={false}
						className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-ink-4"
					/>
					<PasswordInputToggle
						aria-label="Show the key"
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
				<Button type="submit" size="md" tone="primary" disabled={!key.trim() || saving}>
					{saving ? "Checking" : "Use this key"}
				</Button>
				{onCancel && (
					<Button size="md" tone="quiet" onClick={onCancel}>
						Cancel
					</Button>
				)}
			</div>
			{error && (
				<p role="alert" className="selectable text-danger">
					{error}
				</p>
			)}
		</form>
	);
}
