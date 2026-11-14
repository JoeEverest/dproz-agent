import { FieldDescription, FieldLabel, Field as FieldRoot } from "@ui-sdk/react/field";
import { Input as InputBase } from "@ui-sdk/react/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectItemIndicator,
	SelectTrigger,
	SelectValue,
} from "@ui-sdk/react/select";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Textarea as TextareaBase } from "@ui-sdk/react/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { Check, ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

type Tone = "primary" | "secondary" | "quiet" | "danger" | "destructive";

const tones: Record<Tone, string> = {
	primary: "bg-solid text-on-solid hover:bg-solid-hover disabled:bg-fill-press disabled:text-ink-3",
	secondary: "bg-surface text-ink shadow-card hover:bg-fill disabled:text-ink-4",
	quiet: "text-ink-2 hover:bg-fill-hover hover:text-ink disabled:text-ink-4",
	danger: "text-danger hover:bg-danger-wash disabled:text-ink-3",
	destructive: "bg-danger text-canvas hover:opacity-90",
};

const sizes = {
	sm: "h-7 gap-1.5 rounded-md px-2.5 text-[13px]",
	md: "h-8 gap-2 rounded-md px-3 text-sm",
};

export function buttonClass(tone: Tone = "secondary", size: keyof typeof sizes = "md", hasIcon = false) {
	const optical = hasIcon ? "pl-2" : "";
	return `pressable inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap ${sizes[size]} ${optical} ${tones[tone]}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	tone?: Tone;
	size?: keyof typeof sizes;
	icon?: ReactNode;
};

export function Button({ tone, size, icon, className = "", children, ...rest }: ButtonProps) {
	return (
		<button type="button" className={`${buttonClass(tone, size, Boolean(icon))} ${className}`} {...rest}>
			{icon}
			{children}
		</button>
	);
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
	label: string;
	className?: string;
};

export function IconButton({ label, className = "", children, ...rest }: IconButtonProps) {
	return (
		<Tooltip delay={500}>
			<TooltipTrigger
				type="button"
				aria-label={label}
				className={`pressable inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-fill-hover hover:text-ink ${className}`}
				{...rest}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent className="origin-(--transform-origin) rounded-md bg-solid px-2 py-1 text-xs font-medium text-on-solid shadow-pop transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-96 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:transition-[opacity]">
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

const fieldBase =
	"w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-4 transition-[border-color] duration-150 hover:border-ink-3 focus-visible:border-accent focus-visible:outline-offset-0 data-invalid:border-danger";

export function Input({ className = "", ...rest }: ComponentProps<typeof InputBase>) {
	return <InputBase className={`${fieldBase} h-8 ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: ComponentProps<typeof TextareaBase>) {
	return <TextareaBase className={`${fieldBase} resize-none py-1.5 leading-normal ${className}`} {...rest} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<FieldRoot className="flex flex-col gap-1.5">
			<FieldLabel className="text-xs font-medium text-ink-2">{label}</FieldLabel>
			{children}
			{hint && <FieldDescription className="text-xs text-ink-3">{hint}</FieldDescription>}
		</FieldRoot>
	);
}

export function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
}) {
	return (
		<Switch
			checked={checked}
			onCheckedChange={(next) => onChange(next)}
			aria-label={label}
			className="relative h-5 w-9 shrink-0 rounded-full border border-transparent bg-fill-press p-0 transition-[background-color] duration-150 ease-out data-checked:bg-accent"
		>
			<SwitchThumb className="block size-4 translate-x-px rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/25%)] transition-[translate] duration-150 ease-(--ease-out) data-checked:translate-x-[17px]" />
		</Switch>
	);
}

type PickerProps<Value extends string> = {
	value: Value;
	onChange: (value: Value) => void;
	options: readonly { value: Value; label: string }[];
	label: string;
	className?: string;
};

export function Picker<Value extends string>({ value, onChange, options, label, className = "" }: PickerProps<Value>) {
	return (
		<Select value={value} onValueChange={(next) => next !== null && onChange(next as Value)}>
			<SelectTrigger
				aria-label={label}
				className={`pressable inline-flex h-7 max-w-full items-center justify-between gap-2 rounded-md bg-surface pr-1.5 pl-2.5 text-[13px] shadow-card hover:bg-fill data-open:bg-fill ${className}`}
			>
				<span className="truncate">
					<SelectValue />
				</span>
				<ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
			</SelectTrigger>
			<SelectContent className="scroll-quiet max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-[10px] bg-surface p-1 text-[13px] shadow-pop outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-96 data-ending-style:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:transition-[opacity]">
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						className="flex h-7 items-center justify-between gap-6 rounded-md pr-2 pl-2 outline-none data-highlighted:bg-fill-hover"
					>
						{option.label}
						<SelectItemIndicator>
							<Check size={14} strokeWidth={2} className="text-accent" aria-hidden />
						</SelectItemIndicator>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

type ChipTone = "neutral" | "live" | "attention" | "danger" | "success";

const chipTones: Record<ChipTone, string> = {
	neutral: "bg-fill-hover text-ink-2",
	live: "bg-accent-soft text-accent-ink",
	attention: "bg-attention-wash text-attention",
	danger: "bg-danger-wash text-danger",
	success: "bg-sent-wash text-sent-ink",
};

export function Chip({ tone = "neutral", icon, children }: { tone?: ChipTone; icon?: ReactNode; children: ReactNode }) {
	return (
		<span
			className={`inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-xs font-medium whitespace-nowrap ${chipTones[tone]}`}
		>
			{icon}
			<span className="truncate">{children}</span>
		</span>
	);
}

export function Notice({
	tone,
	icon,
	children,
}: {
	tone: "attention" | "danger";
	icon: ReactNode;
	children: ReactNode;
}) {
	const colors =
		tone === "attention" ? "bg-attention-wash [&>svg]:text-attention" : "bg-danger-wash [&>svg]:text-danger";
	return (
		<div
			role="alert"
			className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] [&>svg]:mt-0.5 [&>svg]:shrink-0 ${colors}`}
		>
			{icon}
			<div className="min-w-0">{children}</div>
		</div>
	);
}
