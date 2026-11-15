import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const browsersPath = process.env.DPROZ_AGENT_BROWSERS_PATH;

export async function createSandbox(name, { settings = {}, keep = false } = {}) {
	const base = path.join(root, "tests/e2e/.tmp", name);
	if (!keep) await fs.rm(base, { recursive: true, force: true });
	const userData = path.join(base, "user-data");
	const workspace = path.join(base, "workspace");
	await fs.mkdir(userData, { recursive: true });
	await fs.mkdir(workspace, { recursive: true });
	await fs.writeFile(
		path.join(userData, "settings.json"),
		JSON.stringify({ workspaceDir: workspace, paused: true, ...settings }),
	);
	return { base, userData, workspace };
}

export async function snapshotApp(name) {
	const copy = path.join(root, "tests/e2e/.tmp", `app-${name}`);
	await fs.rm(copy, { recursive: true, force: true });
	await fs.mkdir(copy, { recursive: true });
	await fs.cp(path.join(root, "out"), path.join(copy, "out"), { recursive: true });
	await fs.cp(path.join(root, "resources"), path.join(copy, "resources"), { recursive: true });
	await fs.copyFile(path.join(root, "package.json"), path.join(copy, "package.json"));
	await fs.symlink(path.join(root, "node_modules"), path.join(copy, "node_modules"));
	return copy;
}

export async function launchApp(sandbox, env = {}, appRoot = root) {
	const app = await electron.launch({
		args: [appRoot, ...(process.env.DPROZ_AGENT_ELECTRON_ARGS?.split(" ") ?? [])],
		cwd: appRoot,
		env: {
			...process.env,
			DPROZ_AGENT_USER_DATA: sandbox.userData,
			DPROZ_AGENT_BROWSERS_PATH: browsersPath,
			DPROZ_AGENT_NO_TRAY: "1",
			DPROZ_AGENT_QUIET_WINDOW: "1",
			DPROZ_AGENT_UPDATE_URL: "",
			// No key, so a test never reports usage. A test of the analytics names its own key and host.
			DPROZ_AGENT_POSTHOG_KEY: "",
			// Nothing listens here, so a test can never send a key to the real API by accident.
			DPROZ_AGENT_ANTHROPIC_URL: "http://127.0.0.1:9",
			...env,
		},
	});
	const window = await app.firstWindow();
	await window.waitForLoadState("domcontentloaded");
	window.on("console", (message) => {
		if (message.type() === "error") console.log("[renderer error]", message.text());
	});
	window.on("pageerror", (error) => console.log("[renderer exception]", error.message));
	return { app, window };
}

export const shotsDir = path.join(root, "tests/e2e/.tmp/shots");

export async function shot(window, name) {
	await fs.mkdir(shotsDir, { recursive: true });
	const file = path.join(shotsDir, `${name}.png`);
	await window.screenshot({ path: file });
	return file;
}
