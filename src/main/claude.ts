import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeStatus } from "@shared/ipc";
import { app } from "electron";
import { connectionEnvironment, connectionStatus } from "./connection";
import { bundledClaudeBinary } from "./runtime";

export function claudeEnvironment(): Record<string, string | undefined> {
	return {
		...process.env,
		CLAUDE_AGENT_SDK_CLIENT_APP: `dproz-agent/${app.getVersion()}`,
		...connectionEnvironment(),
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
				reason:
					"Claude Code is not signed in. Run `claude` in a terminal and sign in, or use an API key or another endpoint.",
			};
		}
		return {
			signedIn: true,
			method: connectionStatus().kind,
			email: connectionStatus().kind === "claude-code" ? account.email : undefined,
			subscription: account.subscriptionType,
			// Another endpoint serves the one model it was set up with, not Claude's line-up.
			models:
				connectionStatus().kind === "custom"
					? []
					: models.map((model) => ({ value: model.value, label: model.displayName })),
		};
	} catch (error) {
		return { signedIn: false, reason: (error as Error).message };
	} finally {
		abort.abort();
		probe.close();
	}
}
