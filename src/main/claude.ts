import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeStatus } from "@shared/ipc";
import { app } from "electron";
import { storedApiKey } from "./apiKey";
import { bundledClaudeBinary } from "./runtime";

export function claudeEnvironment(): Record<string, string | undefined> {
	const apiKey = storedApiKey();
	return {
		...process.env,
		CLAUDE_AGENT_SDK_CLIENT_APP: `dproz-agent/${app.getVersion()}`,
		// A key saved in the app is an explicit choice, so it wins over a Claude Code sign-in.
		...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
	};
}

async function* noInput(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
	await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
}

export async function claudeStatus(): Promise<ClaudeStatus> {
	const abort = new AbortController();
	const probe = query({
		prompt: noInput(abort.signal),
		options: {
			settingSources: [],
			env: claudeEnvironment(),
			pathToClaudeCodeExecutable: bundledClaudeBinary(),
			abortController: abort,
		},
	});
	try {
		const { account, models } = await probe.initializationResult();
		const present = (source: string | undefined) => Boolean(source) && source !== "none";
		const hasCredential = Boolean(account.email) || present(account.tokenSource) || present(account.apiKeySource);
		const usesOtherProvider = Boolean(account.apiProvider && account.apiProvider !== "firstParty");
		if (!hasCredential && !usesOtherProvider) {
			return {
				signedIn: false,
				reason: "Claude Code is not signed in. Run `claude` in a terminal and sign in, or use an API key.",
			};
		}
		return {
			signedIn: true,
			method: storedApiKey() ? "api-key" : "claude-code",
			email: storedApiKey() ? undefined : account.email,
			subscription: account.subscriptionType,
			models: models.map((model) => ({ value: model.value, label: model.displayName })),
		};
	} catch (error) {
		return { signedIn: false, reason: (error as Error).message };
	} finally {
		abort.abort();
		probe.close();
	}
}
