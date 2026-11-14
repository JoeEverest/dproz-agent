import { Hand } from "lucide-react";
import { useResource } from "../lib/hooks";
import { Button } from "./ui";

export function HelpBanner() {
	const help = useResource(() => window.desk.help.current(), ["help:changed"]);
	const request = help.data;
	if (!request) return null;

	const respond = (done: boolean) => void window.desk.help.respond(request.id, done);

	return (
		<div
			role="alert"
			className="reveal flex shrink-0 items-center gap-3 border-b border-line bg-attention-wash py-2.5 pr-4 pl-6"
		>
			<Hand size={16} className="shrink-0 text-attention" strokeWidth={1.75} aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="font-semibold">The agent needs you in its browser window</p>
				<p className="selectable text-ink-2">{request.instruction}</p>
			</div>
			<Button size="sm" tone="quiet" onClick={() => respond(false)}>
				Not now
			</Button>
			<Button size="sm" tone="primary" onClick={() => respond(true)}>
				I've done it
			</Button>
		</div>
	);
}
