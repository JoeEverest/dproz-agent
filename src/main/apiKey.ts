import fs from "node:fs/promises";
import path from "node:path";
import type { ApiKeyStatus } from "@shared/ipc";
import { app } from "electron";
import { seal, unseal } from "./credentials";
import { writeFileAtomic } from "./files";

// An Anthropic API key the user gave as an alternative to the Claude Code sign-in. It is kept
// encrypted on disk and only ever handed to the agent's own process; the interface sees a hint.
const API_URL = process.env.DPROZ_AGENT_ANTHROPIC_URL ?? "https://api.anthropic.com";
const keyFile = () => path.join(app.getPath("userData"), "anthropic.key");

let cached: string | undefined;

export async function loadApiKey() {
	try {
		cached = (await unseal(await fs.readFile(keyFile()))) || undefined;
	} catch {
		cached = undefined;
	}
}

export const storedApiKey = () => cached;

export const apiKeyStatus = (): ApiKeyStatus => (cached ? { set: true, hint: cached.slice(-4) } : { set: false });

/** Asks the API whether it accepts the key. Throws when it is refused; a network failure is not a refusal. */
async function verify(key: string) {
	let response: Response;
	try {
		response = await fetch(`${API_URL}/v1/models?limit=1`, {
			headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		return;
	}
	if (response.status === 401 || response.status === 403) {
		throw new Error("Anthropic did not accept that key. Check that it was copied in full and is still active.");
	}
}

export async function saveApiKey(input: string) {
	const key = input.trim();
	if (!key) throw new Error("Paste an API key first.");
	await verify(key);
	await writeFileAtomic(keyFile(), await seal(key));
	cached = key;
}

export async function clearApiKey() {
	await fs.rm(keyFile(), { force: true });
	cached = undefined;
}
