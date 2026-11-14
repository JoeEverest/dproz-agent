import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, buttonClass, Textarea } from "./ui";

export function AddJob() {
	const [open, setOpen] = useState(false);
	const [source, setSource] = useState("");

	const add = async (prepareOnly: boolean) => {
		await window.desk.applications.addJob(source.trim(), prepareOnly);
		setSource("");
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger className={buttonClass("primary", "sm", true)}>
				<Plus size={14} strokeWidth={2} aria-hidden />
				Add a job
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={8}
				className="app w-[380px] origin-(--transform-origin) rounded-xl bg-surface p-4 text-ink shadow-pop outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-96 data-ending-style:opacity-0 data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:transition-[opacity]"
			>
				<PopoverTitle className="text-sm font-semibold">Add a job you found</PopoverTitle>
				<PopoverDescription className="mt-0.5 text-ink-3">
					Paste the link to the posting, or the posting itself. It gets a card on the board straight away.
				</PopoverDescription>
				<Textarea
					className="mt-3 max-h-48"
					rows={3}
					autoResize
					value={source}
					onValueChange={(value) => setSource(value)}
					placeholder="https://…"
					aria-label="Job link or posting"
				/>
				<div className="mt-3 flex justify-end gap-2">
					<Button size="sm" disabled={!source.trim()} onClick={() => void add(true)}>
						Prepare only
					</Button>
					<Button size="sm" tone="primary" disabled={!source.trim()} onClick={() => void add(false)}>
						Apply for me
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
