import type { Question } from "@shared/application";
import { type FormEvent, useState } from "react";
import { Button, Textarea } from "./ui";

type Props = { question: Question; onAnswer: (answer: string) => Promise<unknown> };

export function QuestionForm({ question, onAnswer }: Props) {
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (question.answer) {
		return (
			<div className="rounded-lg border border-line px-3 py-2.5">
				<p className="selectable text-ink-2">{question.question}</p>
				<p className="selectable mt-1 font-medium whitespace-pre-wrap">{question.answer}</p>
			</div>
		);
	}

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!draft.trim()) return;
		setSaving(true);
		setError(null);
		try {
			await onAnswer(draft.trim());
		} catch (cause) {
			setError(`That did not save: ${(cause as Error).message}`);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={(event) => void submit(event)} className="rounded-lg bg-attention-wash px-3 py-2.5">
			<p className="selectable font-medium">{question.question}</p>
			{question.why && <p className="selectable mt-0.5 text-xs text-ink-2">{question.why}</p>}
			<Textarea
				className="mt-2 max-h-40"
				rows={2}
				autoResize
				value={draft}
				onValueChange={(value) => setDraft(value)}
				submitShortcut="mod+enter"
				placeholder="Your answer"
				aria-label={question.question}
			/>
			{error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
			<div className="mt-2 flex justify-end">
				<Button type="submit" size="sm" tone="primary" disabled={!draft.trim() || saving}>
					{saving ? "Saving" : "Answer"}
				</Button>
			</div>
		</form>
	);
}
