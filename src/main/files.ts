import fs from "node:fs/promises";
import path from "node:path";

export async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

/** A text file's contents, or nothing when it is not there. */
export const readText = (file: string) => fs.readFile(file, "utf8").catch(() => "");

export async function writeFileAtomic(file: string, content: string | Uint8Array) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(temporary, content);
	await fs.rename(temporary, file);
}

export const writeJson = (file: string, value: unknown) =>
	writeFileAtomic(file, `${JSON.stringify(value, null, "\t")}\n`);

export async function exists(file: string) {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

export function isInside(parent: string, candidate: string) {
	const relative = path.relative(parent, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
