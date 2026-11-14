const parts = (version: string) =>
	version
		.replace(/^v/, "")
		.split(/[.-]/)
		.map((part) => Number.parseInt(part, 10) || 0);

/** True when `latest` is a higher version than `current` (numeric compare of dotted parts). */
export function isNewer(latest: string, current: string) {
	const a = parts(latest);
	const b = parts(current);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return false;
}
