const DAY = 86_400_000;

export function relativeTime(iso: string) {
	const elapsed = Date.now() - Date.parse(iso);
	if (elapsed < 60_000) return "just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
	if (elapsed < DAY) return `${Math.floor(elapsed / 3_600_000)} h ago`;
	if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`;
	return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function shortAge(iso: string) {
	const elapsed = Date.now() - Date.parse(iso);
	if (elapsed < 60_000) return "now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
	if (elapsed < DAY) return `${Math.floor(elapsed / 3_600_000)}h`;
	if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d`;
	return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function whenNext(iso: string) {
	const date = new Date(iso);
	const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	const today = new Date().toDateString() === date.toDateString();
	return today ? `Today at ${time}` : `${date.toLocaleDateString(undefined, { weekday: "short" })} at ${time}`;
}

export function clockTime(iso: string) {
	return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function deadline(iso: string | undefined): { text: string; urgent: boolean } | null {
	if (!iso) return null;
	const time = Date.parse(iso);
	if (Number.isNaN(time)) return null;
	const days = Math.ceil((time - Date.now()) / DAY);
	if (days < 0) return { text: "Deadline passed", urgent: true };
	if (days === 0) return { text: "Closes today", urgent: true };
	if (days === 1) return { text: "Closes tomorrow", urgent: true };
	if (days <= 14) return { text: `Closes in ${days} days`, urgent: days <= 3 };
	return {
		text: `Closes ${new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
		urgent: false,
	};
}

export function fileSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function hostOf(url: string | undefined) {
	if (!url) return "";
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}
