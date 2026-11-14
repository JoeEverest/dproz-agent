import { awaitingChoice, type Question, type QuestionReply } from "@shared/application";
import { type FormEvent, useState } from "react";
import { HaveChoice } from "./HaveChoice";
import { Button, Textarea } from "./ui";

type Props = { question: Question; onAnswer: (reply: QuestionReply) => Promise<unknown> };

export function QuestionForm({ question, onAnswer }: Props) {
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (question.answer) {
		return (
			<div className="rounded-lg border border-line px-3 py-2.5">
				<p className="selectable text-ink-2">{question.item ?? question.question}</p>
				<p className="selectable mt-1 font-medium whitespace-pre-wrap">{question.answer}</p>
			</div>
		);
	}

	const send = async (reply: QuestionReply) => {
		setSaving(true);
		setError(null);
		try {
			await onAnswer(reply);
			setDraft("");
		} catch (cause) {
			setError(`That did not save: ${(cause as Error).message}`);
		} finally {
			setSaving(false);
		}
	};

	if (awaitingChoice(question)) {
		return (
			<div className="rounded-lg bg-attention-wash px-3 py-2.5">
				<HaveChoice question={question} disabled={saving} onChoose={(have) => void send({ have })} />
				{error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
			</div>
		);
	}

	// A quick question the user has, now asking for the detail. It can be skipped.
	const followingUp = Boolean(question.item && question.have);
	const prompt = followingUp ? (question.followUp ?? question.question) : question.question;
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (draft.trim()) void send(draft.trim());
	};

	return (
		<form onSubmit={submit} className="rounded-lg bg-attention-wash px-3 py-2.5">
			{followingUp && <p className="selectable mb-1 text-xs text-ink-2">You have: {question.item}</p>}
			<p className="selectable font-medium">{prompt}</p>
			{question.why && <p className="selectable mt-0.5 text-xs text-ink-2">{question.why}</p>}
			<Textarea
				className="mt-2 max-h-40"
				rows={2}
				autoResize
				value={draft}
				onValueChange={(value) => setDraft(value)}
				submitShortcut="mod+enter"
				placeholder="Your answer"
				aria-label={prompt}
			/>
			{error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
			<div className="mt-2 flex justify-end gap-2">
				{followingUp && (
					<Button type="button" size="sm" disabled={saving} onClick={() => void send("")}>
						Skip
					</Button>
				)}
				<Button type="submit" size="sm" tone="primary" disabled={!draft.trim() || saving}>
					{saving ? "Saving" : "Answer"}
				</Button>
			</div>
		</form>
	);
}
