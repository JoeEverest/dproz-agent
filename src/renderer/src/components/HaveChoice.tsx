import { type Question, REQUIREMENT_LABELS } from "@shared/application";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

type OptionProps = {
	tone: "have" | "lack";
	title: string;
	note: string;
	icon: ReactNode;
	disabled?: boolean;
	onClick: () => void;
};

function Option({ tone, title, note, icon, disabled, onClick }: OptionProps) {
	const look =
		tone === "have"
			? "hover:border-sent hover:bg-sent-wash [&>span:first-child]:bg-sent-wash [&>span:first-child]:text-sent-ink"
			: "hover:border-attention hover:bg-attention-wash [&>span:first-child]:bg-attention-wash [&>span:first-child]:text-attention";
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={`pressable flex items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left transition-[border-color,background-color] duration-150 disabled:opacity-60 ${look}`}
		>
			<span className="flex size-7 shrink-0 items-center justify-center rounded-full">{icon}</span>
			<span className="min-w-0">
				<span className="block font-medium">{title}</span>
				<span className="block text-xs text-ink-3">{note}</span>
			</span>
		</button>
	);
}

type Props = { question: Question; disabled?: boolean; onChoose: (have: boolean) => void };

/**
 * A quick question, answered with one click. The two answers and their wording are the ones Dproz Fit
 * Check asks about a requirement a CV does not show.
 */
export function HaveChoice({ question, disabled, onChoose }: Props) {
	return (
		<fieldset className="min-w-0">
			<legend className="contents">
				{question.category && <span className="block text-xs text-ink-3">{REQUIREMENT_LABELS[question.category]}</span>}
				<span className="selectable block font-medium text-pretty">{question.item}</span>
			</legend>
			<p className="mt-0.5 text-xs text-ink-2">
				Nothing you have given the agent shows this yet. Which is closer to the truth?
			</p>
			<div className="mt-2.5 grid grid-cols-2 gap-2">
				<Option
					tone="have"
					title="I have it"
					note="Just not in my documents yet"
					icon={<Check size={15} strokeWidth={2} aria-hidden />}
					disabled={disabled}
					onClick={() => onChoose(true)}
				/>
				<Option
					tone="lack"
					title="Not yet"
					note="I do not have this"
					icon={<X size={15} strokeWidth={2} aria-hidden />}
					disabled={disabled}
					onClick={() => onChoose(false)}
				/>
			</div>
		</fieldset>
	);
}
