import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { app } from "electron";
import { broadcast } from "./events";

const nodeRequire = createRequire(import.meta.url);

const unpacked = (file: string) => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function resolvePackageFile(packageName: string, file: string, from = nodeRequire) {
	return unpacked(path.join(path.dirname(from.resolve(`${packageName}/package.json`)), file));
}

const playwrightMcpCli = () => resolvePackageFile("@playwright/mcp", "cli.js");

function playwrightCore(file: string) {
	const fromMcp = createRequire(nodeRequire.resolve("@playwright/mcp/package.json"));
	return resolvePackageFile("playwright-core", file, fromMcp);
}

export function bundledClaudeBinary(): string | undefined {
	if (!app.isPackaged) return undefined;
	const executable = process.platform === "win32" ? "claude.exe" : "claude";
	return resolvePackageFile(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`, executable);
}

export const browsersPath = () =>
	process.env.DPROZ_AGENT_BROWSERS_PATH ?? path.join(app.getPath("userData"), "browsers");

export const browserProfileDir = () => path.join(app.getPath("userData"), "browser-profile");

const nodeEnv = () => ({ ELECTRON_RUN_AS_NODE: "1", PLAYWRIGHT_BROWSERS_PATH: browsersPath() });

export async function isBrowserInstalled() {
	try {
		const { browsers } = JSON.parse(await fs.readFile(playwrightCore("browsers.json"), "utf8")) as {
			browsers: { name: string; revision: string }[];
		};
		const revision = browsers.find((browser) => browser.name === "chromium")?.revision;
		await fs.access(path.join(browsersPath(), `chromium-${revision}`, "INSTALLATION_COMPLETE"));
		return true;
	} catch {
		return false;
	}
}

/** Where the downloaded Chromium's program is, asked of Playwright, which names it differently per platform. */
export function browserExecutable(): Promise<string> {
	const script = "process.stdout.write(require(process.argv[1]).chromium.executablePath())";
	return new Promise((resolve, reject) => {
		execFile(
			process.execPath,
			["-e", script, path.dirname(playwrightCore("package.json"))],
			{ env: { ...process.env, ...nodeEnv() } },
			(failure, stdout) => (failure || !stdout ? reject(failure ?? new Error("No browser found")) : resolve(stdout)),
		);
	});
}

let installing: Promise<void> | null = null;

export function installBrowser(): Promise<void> {
	installing ??= new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, [playwrightCore("cli.js"), "install", "chromium", "--no-shell"], {
			env: { ...process.env, ...nodeEnv() },
		});
		let lastLine = "";
		const report = (chunk: Buffer) => {
			for (const line of chunk.toString().split(/[\r\n]+/)) {
				if (!line.trim()) continue;
				lastLine = line.trim();
				broadcast("setup:browser-progress", { line: lastLine, done: false });
			}
		};
		child.stdout.on("data", report);
		child.stderr.on("data", report);
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(lastLine || `Browser download exited with code ${code}`));
		});
	})
		.then(() => broadcast("setup:browser-progress", { line: "Browser ready", done: true }))
		.catch((error: Error) => {
			broadcast("setup:browser-progress", { line: error.message, done: true, error: error.message });
			throw error;
		})
		.finally(() => {
			installing = null;
		});
	return installing;
}

export const BROWSER_SERVER = "browser";

export const testOrigin = () => process.env.DPROZ_AGENT_TEST_ORIGIN || undefined;

export const BROWSER_INPUT_TOOLS = [
	"browser_click",
	"browser_type",
	"browser_fill_form",
	"browser_select_option",
	"browser_press_key",
	"browser_file_upload",
	"browser_drag",
	"browser_drop",
	"browser_evaluate",
	"browser_run_code_unsafe",
	"browser_handle_dialog",
].map((tool) => `mcp__${BROWSER_SERVER}__${tool}`);

export function browserServer(workspaceDir: string): McpStdioServerConfig {
	return {
		type: "stdio",
		command: process.execPath,
		args: [
			playwrightMcpCli(),
			"--browser",
			"chromium",
			"--user-data-dir",
			browserProfileDir(),
			"--output-dir",
			path.join(workspaceDir, ".browser"),
			"--viewport-size",
			"1280x900",
			...(process.env.DPROZ_AGENT_HEADLESS ? ["--headless"] : []),
			...(testOrigin() ? ["--allowed-origins", testOrigin() as string] : []),
		],
		env: nodeEnv(),
		alwaysLoad: true,
	};
}
