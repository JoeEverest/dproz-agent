// Uses only synthetic questions in a paused, isolated profile; no agent run.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

const sandbox = await createSandbox("shortcuts", { settings: { onboarded: true } });
await fs.writeFile(
	path.join(sandbox.workspace, "inbox.json"),
	JSON.stringify(
		[1, 2, 3, 4].map((id) => ({
			id: `shortcut-${id}`,
			question: `Question ${id}`,
			askedAt: new Date(id).toISOString(),
		})),
	),
);
let running;
try {
	running = await launchApp(sandbox);
	let { window } = running;
	const questions = async () => {
		await window
			.getByRole("navigation")
			.getByRole("button", { name: /^Questions/ })
			.click();
		return window.locator("#agent-panel textarea");
	};
	const answers = () => window.evaluate(async () => (await window.desk.inbox.list()).filter((q) => q.answer));
	assert.equal(
		await window.evaluate(() => window.desk.settings.get().then((s) => s.questionSendShortcut)),
		"mod+enter",
	);
	let input = await questions();
	await input.fill("First line");
	await input.press("Enter");
	assert.equal(await input.inputValue(), "First line\n");
	assert.equal((await answers()).length, 0);
	await input.press("ControlOrMeta+Enter");
	await window.getByText("First line", { exact: true }).waitFor();
	assert.equal((await answers()).length, 1);

	await window.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
	await window.getByRole("switch", { name: "Enter sends answers" }).click();
	await window.waitForFunction(async () => (await window.desk.settings.get()).questionSendShortcut === "enter");
	await shot(window, "shortcuts-settings");
	await running.app.close();
	running = await launchApp(sandbox);
	window = running.window;
	assert.equal(await window.evaluate(() => window.desk.settings.get().then((s) => s.questionSendShortcut)), "enter");
	input = await questions();
	await input.fill("Second line");
	await input.press("Shift+Enter");
	assert.equal(await input.inputValue(), "Second line\n");
	for (const init of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
		await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, ...init });
	}
	assert.equal((await answers()).length, 1);
	assert.equal(await input.inputValue(), "Second line\n");
	await shot(window, "shortcuts-composer");
	await input.press("Enter");
	await window.getByText("Second line", { exact: true }).waitFor();
	assert.equal((await answers()).length, 2);
	await input.fill("Next draft");
	await input.dispatchEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
	assert.equal((await answers()).length, 2);
	assert.equal(await input.inputValue(), "Next draft");
	await window.getByRole("button", { name: "Send answer", exact: true }).click();
	await window.getByText("Next draft", { exact: true }).waitFor();
	assert.equal((await answers()).length, 3);
	await input.fill("   ");
	await input.press("Enter");
	assert.equal((await answers()).length, 3);
	await running.app.evaluate(({ ipcMain }) => {
		globalThis.shortcutAttempts = 0;
		ipcMain.removeHandler("inbox:answer");
		ipcMain.handle("inbox:answer", async () => {
			globalThis.shortcutAttempts++;
			await new Promise((resolve) => setTimeout(resolve, 300));
			throw new Error("Test send failure");
		});
	});
	await input.fill("Keep for retry");
	await input.evaluate((element) => {
		element.form.requestSubmit();
		element.form.requestSubmit();
	});
	await window.getByRole("alert").filter({ hasText: "Test send failure" }).waitFor();
	assert.equal(await running.app.evaluate(() => globalThis.shortcutAttempts), 1);
	assert.equal(await input.inputValue(), "Keep for retry");
	await input.press("Enter");
	await window.getByRole("alert").filter({ hasText: "Test send failure" }).waitFor();
	assert.equal(await running.app.evaluate(() => globalThis.shortcutAttempts), 2);
	assert.equal(await input.inputValue(), "Keep for retry");
	console.log("RESULT: shortcut defaults, persistence, newlines, sends, repeats and composition passed");
} finally {
	await running?.app.close();
}
