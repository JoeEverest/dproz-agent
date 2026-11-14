import os from "node:os";
import path from "node:path";

const defaultBrowsers = {
	darwin: path.join(os.homedir(), "Library/Application Support/Dproz Agent/browsers"),
	linux: path.join(os.homedir(), ".config/Dproz Agent/browsers"),
	win32: path.join(process.env.APPDATA ?? os.homedir(), "Dproz Agent/browsers"),
}[process.platform];

process.env.DPROZ_AGENT_BROWSERS_PATH ??= defaultBrowsers;
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.DPROZ_AGENT_BROWSERS_PATH;

await import(`./${process.argv[2] ?? "full"}.mjs`);
