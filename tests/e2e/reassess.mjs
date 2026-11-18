// Reassess a job from its drawer, with the agent paused so nothing runs: which cards offer it, the
// optional note, the waiting state, one queued run however often it is asked, and no way to resend.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

const sandbox = await createSandbox("reassess", { settings: { onboarded: true } });
await fs.writeFile(
	path.join(sandbox.userData, "agent.json"),
	JSON.stringify({ lastSweepAt: new Date().toISOString() }),
);
const at = new Date(Date.UTC(2026, 10, 15, 10)).toISOString();
const statuses = ["found", "needs_input", "ready_to_submit", "manual", "applied", "interview", "closed"];
const cardFile = (id) => path.join(sandbox.workspace, "applications", id, "application.json");
for (const status of statuses) {
	await fs.mkdir(path.dirname(cardFile(status)), { recursive: true });
	await fs.writeFile(
		cardFile(status),
		JSON.stringify({
			id: status,
			title: `Job at ${status}`,
			company: "Kilele Foods Ltd",
			status,
			...(status === "closed" ? { closedReason: "Asks for five years in FMCG." } : {}),
			timeline: [{ at, event: "Found" }],
			createdAt: at,
			updatedAt: at,
		}),
	);
}

// The agent stays paused throughout, so no run ever starts.
const { app, window } = await launchApp(sandbox);
let checks = 0;
const check = (name, passed) => {
	assert.ok(passed, name);
	console.log("PASS", name);
	checks++;
};
const drawer = window.getByRole("dialog");
const reassessButton = drawer.getByRole("button", { name: "Reassess", exact: true });
const open = async (id) => {
	await window.locator(`li[data-card="${id}"] > button`).click();
	await drawer.getByText(`Job at ${id}`, { exact: true }).waitFor();
};
const close = async () => {
	await drawer.getByRole("button", { name: "Close", exact: true }).click();
	await drawer.waitFor({ state: "hidden" });
};
const agentState = () => window.evaluate(() => window.desk.agent.state());
const history = async (id) => JSON.parse(await fs.readFile(cardFile(id), "utf8")).timeline.map((entry) => entry.event);

try {
	await window.locator('li[data-card="closed"]').waitFor();
	for (const status of statuses) {
		await open(status);
		const offered = await reassessButton.isVisible();
		const sent = status === "applied" || status === "interview";
		check(`${status}: Reassess is ${sent ? "not offered" : "offered"}`, offered === !sent);
		await close();
	}

	await open("closed");
	await reassessButton.click();
	const form = drawer.getByRole("textbox", { name: "What changed (optional)" });
	check("the note box takes focus", await form.evaluate((el) => el === document.activeElement));
	console.log(await shot(window, "reassess-form"));
	await form.fill("A note for the closed job.");
	await close();
	await open("found");
	check(
		"a note left open on one card does not follow to the next",
		(await reassessButton.isVisible()) && !(await form.isVisible()),
	);
	await close();
	await open("closed");
	await reassessButton.click();
	check("the form opens empty again", (await form.inputValue()) === "");
	await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
	check("cancel leaves nothing queued", (await agentState()).queued === 0 && (await reassessButton.isVisible()));

	await reassessButton.click();
	await form.fill("I'd like to apply despite the travel.");
	await drawer.getByRole("button", { name: "Reassess", exact: true }).last().click();
	await drawer.getByText("Waiting to reassess this", { exact: true }).waitFor();
	check(
		"the card shows it is waiting, and that the agent is paused",
		await drawer.getByText(/agent is paused/).isVisible(),
	);
	check("Reassess is not offered while it waits", !(await reassessButton.isVisible()));
	let state = await agentState();
	check("one run is queued for this card", state.queued === 1 && state.waiting.join() === "closed");
	check("the history is written when the run starts, not while it waits", (await history("closed")).join() === "Found");
	console.log(await shot(window, "reassess-waiting"));

	await window.evaluate(async () => {
		await window.desk.applications.reassess("closed", "A newer note.");
		await window.desk.applications.reassess("closed");
	});
	state = await agentState();
	check("asking again keeps one queued run", state.queued === 1 && state.waiting.join() === "closed");

	const refused = await window.evaluate(() =>
		window.desk.applications.reassess("applied", "Send it again").then(
			() => "",
			(error) => error.message,
		),
	);
	check("main refuses to reassess an application already sent", refused.includes("already been sent"));
	state = await agentState();
	check("the refusal queues nothing", state.queued === 1 && (await history("applied")).join() === "Found");

	await close();
	console.log(`${checks} checks passed`);
} finally {
	await app.close();
}
