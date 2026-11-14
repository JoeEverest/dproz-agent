/**
 * The agent's browser, opened for the user.
 *
 * The agent drives its own Chromium with a profile it keeps between runs. Opening that same profile for
 * the user lets them sign in to their email and job sites once, by hand, and the agent finds itself
 * signed in on every later run. Only one browser can have the profile open, so the agent starts
 * nothing while the user's window is up.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { agent } from "./agent/manager";
import { browserExecutable, browserProfileDir, isBrowserInstalled } from "./runtime";

export type BrowserOpened = { ok: true } | { ok: false; reason: string };

let child: ChildProcess | null = null;

// The agent's runs start Chromium with these two, and a profile's cookies only open under the same key.
const args = (url?: string) => [
	`--user-data-dir=${browserProfileDir()}`,
	"--no-first-run",
	"--no-default-browser-check",
	"--use-mock-keychain",
	"--password-store=basic",
	// As in the agent's runs: Chromium's sandbox needs a kernel setting many Linux desktops turn off.
	...(process.platform === "linux" ? ["--no-sandbox"] : []),
	...(url ? [url] : []),
];

export async function openUserBrowser(url?: string): Promise<BrowserOpened> {
	if (!(await isBrowserInstalled())) return { ok: false, reason: "The agent's browser has not been downloaded yet." };
	const executable = await browserExecutable();
	if (child) {
		// Already open: starting it again on the same profile only brings up a window in the running one.
		spawn(executable, args(url), { stdio: "ignore", detached: true }).unref();
		return { ok: true };
	}
	if (!agent.holdForBrowser()) {
		return { ok: false, reason: "The agent is using its browser right now. Pause it, or try again when it is idle." };
	}
	const started = spawn(executable, args(url), { stdio: "ignore" });
	child = started;
	const release = () => {
		if (child !== started) return;
		child = null;
		agent.releaseBrowser();
	};
	started.once("exit", release);
	started.once("error", release);
	return { ok: true };
}

/** Ask the browser to quit the way a user would, so the sign-ins made in it are written to disk. */
export function closeUserBrowser() {
	if (!child?.pid) return;
	// SIGTERM stops Chromium at once and loses cookies from the last half minute; SIGINT lets it shut down.
	if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid)], () => {});
	else child.kill("SIGINT");
}
