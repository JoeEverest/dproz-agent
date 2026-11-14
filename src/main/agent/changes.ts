/** The lines an edit took out and the lines it put in, ignoring blank lines and moved ones. */
export function changedLines(before: string, after: string) {
	const lines = (text: string) =>
		text
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	const was = new Set(lines(before));
	const is = new Set(lines(after));
	return {
		removed: lines(before).filter((line) => !is.has(line)),
		added: lines(after).filter((line) => !was.has(line)),
	};
}
