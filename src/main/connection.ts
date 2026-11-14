import fs from "node:fs/promises";
import path from "node:path";
import type { ConnectionStatus, EndpointInput } from "@shared/ipc";
import { app } from "electron";
import { seal, unseal } from "./credentials";
import { writeFileAtomic } from "./files";

// How the agent reaches a model when the user does not want the Claude Code sign-in: an Anthropic
// API key, or any endpoint that speaks the Anthropic Messages API (a gateway, or Ollama for
// open-weight models). Kept encrypted on disk; the interface only ever sees a summary.
type Stored =
	| { kind: "api-key"; key: string }
	| { kind: "custom"; baseUrl: string; model: string; token?: string; header: "bearer" | "x-api-key" };

const ANTHROPIC_URL = process.env.DPROZ_AGENT_ANTHROPIC_URL ?? "https://api.anthropic.com";
const file = () => path.join(app.getPath("userData"), "connection.sealed");

let stored: Stored | undefined;

export async function loadConnection() {
	try {
		stored = JSON.parse(await unseal(await fs.readFile(file()))) as Stored;
	} catch {
		stored = undefined;
	}
}

export function connectionStatus(): ConnectionStatus {
	if (stored?.kind === "api-key") return { kind: "api-key", hint: stored.key.slice(-4) };
	if (stored?.kind === "custom") {
		return { kind: "custom", baseUrl: stored.baseUrl, model: stored.model, hasToken: Boolean(stored.token) };
	}
	return { kind: "claude-code" };
}

/** The model a custom endpoint was set up with; it replaces the model picker. */
export const connectionModel = () => (stored?.kind === "custom" ? stored.model : undefined);

/** Environment for the agent's process. A saved connection is an explicit choice, so it wins over a Claude Code sign-in. */
export function connectionEnvironment(): Record<string, string> {
	if (stored?.kind === "api-key") return { ANTHROPIC_API_KEY: stored.key };
	if (stored?.kind !== "custom") return {};
	const credential = stored.token || "none";
	return {
		ANTHROPIC_BASE_URL: stored.baseUrl,
		// Exactly one credential variable carries the token; the other is blanked so a key from the
		// surrounding environment is never sent to somebody else's server.
		ANTHROPIC_AUTH_TOKEN: stored.header === "bearer" ? credential : "",
		ANTHROPIC_API_KEY: stored.header === "x-api-key" ? credential : "",
		// Every role (main, helpers, background tasks) uses the one model this endpoint was set up with.
		ANTHROPIC_MODEL: stored.model,
		ANTHROPIC_DEFAULT_OPUS_MODEL: stored.model,
		ANTHROPIC_DEFAULT_SONNET_MODEL: stored.model,
		ANTHROPIC_DEFAULT_HAIKU_MODEL: stored.model,
		// Other servers reject fields and side requests that only Anthropic's own API understands.
		CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	};
}

async function save(next: Stored) {
	await writeFileAtomic(file(), await seal(JSON.stringify(next)));
	stored = next;
}

export async function clearConnection() {
	await fs.rm(file(), { force: true });
	stored = undefined;
}

export async function saveApiKey(input: string) {
	const key = input.trim();
	if (!key) throw new Error("Paste an API key first.");
	let response: Response | undefined;
	try {
		response = await fetch(`${ANTHROPIC_URL}/v1/models?limit=1`, {
			headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		// No network is not a refusal; the key is saved and the first run will say if it is wrong.
	}
	if (response?.status === 401 || response?.status === 403) {
		throw new Error("Anthropic did not accept that key. Check that it was copied in full and is still active.");
	}
	await save({ kind: "api-key", key });
}

function normalizeBaseUrl(input: string) {
	const trimmed = input.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
	} catch {
		throw new Error("That does not look like a web address. Example: http://localhost:11434");
	}
	// People paste the full API path; the agent adds /v1/messages itself.
	return url
		.toString()
		.replace(/\/+$/, "")
		.replace(/\/v1(\/messages)?$/, "");
}

/** Sends a one-token message, the same request the agent will make. */
async function probe(baseUrl: string, model: string, token: string, header: "bearer" | "x-api-key") {
	return fetch(`${baseUrl}/v1/messages`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"anthropic-version": "2023-06-01",
			...(header === "bearer" ? { authorization: `Bearer ${token}` } : { "x-api-key": token }),
		},
		body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "." }] }),
		// A local model may need to be loaded into memory before it answers.
		signal: AbortSignal.timeout(120_000),
	});
}

export async function saveEndpoint(input: EndpointInput) {
	const baseUrl = normalizeBaseUrl(input.baseUrl);
	const model = input.model.trim();
	const token = input.token?.trim() || undefined;
	if (!model) throw new Error("Name the model to use, for example qwen3.5.");

	let header: "bearer" | "x-api-key" = "bearer";
	let response: Response;
	try {
		response = await probe(baseUrl, model, token ?? "none", header);
		if ((response.status === 401 || response.status === 403) && token) {
			// Some gateways read the key from x-api-key instead of a bearer token.
			const retry = await probe(baseUrl, model, token, "x-api-key");
			if (retry.status !== 401 && retry.status !== 403) {
				header = "x-api-key";
				response = retry;
			}
		}
	} catch (cause) {
		const timedOut = (cause as Error).name === "TimeoutError";
		throw new Error(
			timedOut
				? `${baseUrl} did not answer within two minutes.`
				: `Nothing answered at ${baseUrl}. Check the address, and that the server is running.`,
		);
	}

	if (response.status === 401 || response.status === 403) {
		throw new Error(token ? "That server did not accept the token." : "That server needs a token.");
	}
	if (!response.ok) {
		const body = (await response.text().catch(() => "")).slice(0, 300);
		const detail = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? body;
		if (response.status === 404 && !/model/i.test(detail)) {
			throw new Error(`${baseUrl} does not offer the Anthropic Messages API (no /v1/messages there).`);
		}
		throw new Error(`The server answered ${response.status}${detail ? `: ${detail}` : "."}`);
	}
	await save({ kind: "custom", baseUrl, model, token, header });
}
