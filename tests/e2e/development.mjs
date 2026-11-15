import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright";
import { createSandbox } from "./harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sandbox = await createSandbox("development");
const installedData = path.join(sandbox.base, "installed");
const developmentData = path.join(sandbox.base, "Dproz Agent Development");
await fs.mkdir(installedData, { recursive: true });

async function launch(packaged, override = "") {
	const entry = path.join(sandbox.base, `${packaged ? "installed" : "development"}-entry.mjs`);
	// Exercise both runtime branches without accessing an installed app's real profile.
	await fs.writeFile(
		entry,
		`import { app } from 'electron';
app.setPath('appData', ${JSON.stringify(sandbox.base)});
app.setPath('userData', ${JSON.stringify(installedData)});
Object.defineProperty(app, 'isPackaged', { value: ${packaged} });
await import(${JSON.stringify(pathToFileURL(path.join(root, "out/main/index.js")).href)});
`,
	);
	const app = await electron.launch({
		args: [entry, ...(process.env.DPROZ_AGENT_ELECTRON_ARGS?.split(" ") ?? [])],
		cwd: root,
		env: {
			...process.env,
			DPROZ_AGENT_USER_DATA: override,
			DPROZ_AGENT_NO_TRAY: "1",
			DPROZ_AGENT_QUIET_WINDOW: "1",
			DPROZ_AGENT_UPDATE_URL: "",
			DPROZ_AGENT_POSTHOG_KEY: "",
		},
	});
	const window = await app.firstWindow();
	await window.waitForFunction(() => Boolean(window.desk));
	return { app, window };
}

let installed;
let development;
try {
	installed = await launch(true);
	development = await launch(false);
	assert.equal(await installed.app.evaluate(({ app }) => app.getPath("userData")), installedData);
	assert.equal(await development.app.evaluate(({ app }) => app.getPath("userData")), developmentData);
	assert.equal(await installed.window.evaluate(() => window.desk.isDevelopment), false);
	assert.equal(await installed.window.getByText("Development", { exact: true }).count(), 0);
	await development.window.getByText("Development", { exact: true }).waitFor();
	assert.equal(await development.window.title(), "Dproz Agent (Development)");
	await development.window.evaluate(() => window.desk.settings.update({ paused: true, autoSubmit: false }));
	await development.app.close();
	development = await launch(false);
	assert.equal(await development.window.evaluate(async () => (await window.desk.settings.get()).autoSubmit), false);
	assert.equal(await installed.window.evaluate(async () => (await window.desk.settings.get()).autoSubmit), true);
	await development.window.evaluate(() => window.desk.settings.update({ onboarded: true }));
	await development.window.reload();
	await development.window.getByRole("button", { name: "Collapse the sidebar" }).click();
	assert.equal(await development.window.getByText("Development", { exact: true }).isVisible(), true);
	await development.app.close();
	development = await launch(false, sandbox.userData);
	assert.equal(await development.app.evaluate(({ app }) => app.getPath("userData")), sandbox.userData);
	console.log("RESULT: concurrent profiles, restart persistence, override and development identity passed");
} finally {
	await development?.app.close();
	await installed?.app.close();
}
