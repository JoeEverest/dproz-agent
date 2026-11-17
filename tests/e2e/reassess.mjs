// Reassess a job from its drawer, with the agent paused so nothing runs: which cards offer it, the
// optional note, the waiting state, one queued run however often it is asked, and no way to resend.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
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

// The agent's own runs go to a stand-in that refuses every request, so resuming it below can never
// reach a model or an account signed in on this machine.
const refusedRequests = [];
const api = http.createServer((request, response) => {
	refusedRequests.push(request.url);
	request.resume();
	response.statusCode = 401;
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "test stand-in" } }));
});
await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const { app, window } = await launchApp(sandbox, {
	ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}`,
	ANTHROPIC_API_KEY: "test-no-key",
	ANTHROPIC_AUTH_TOKEN: "",
});
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
const until = async (condition, timeout) => {
	const end = Date.now() + timeout;
	while (!(await condition())) {
		if (Date.now() > end) throw new Error("Timed out waiting for the agent");
		await window.waitForTimeout(200);
	}
};
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

	await window.evaluate(() => window.desk.agent.setPaused(true).then(() => window.desk.agent.setPaused(false)));
	await until(async () => (await agentState()).waiting.length === 0, 10_000);
	await drawer.getByText(/You asked the agent to reassess this/).waitFor();
	check(
		"the history notes the request, with the latest note, once the run starts",
		(await history("closed")).join("|") === 'Found|You asked the agent to reassess this: "A newer note."',
	);
	check(
		"the card stays Closed until the agent moves it",
		JSON.parse(await fs.readFile(cardFile("closed"), "utf8")).status === "closed",
	);
	check("the card shows as worked on while its run goes", (await agentState()).active.closed === "Reassessing");
	await until(async () => refusedRequests.some((url) => url.startsWith("/v1/messages")), 60_000);
	// The stand-in refuses every request, so the run would only retry: stop it.
	await window.evaluate(() => window.desk.agent.setPaused(true));
	await until(async () => (await agentState()).status === "idle", 30_000);
	const activity = await window.evaluate(() => window.desk.agent.activity());
	check(
		"the run went to the stand-in, not a real model, and used no tools",
		!activity.some((item) => item.kind === "tool"),
	);
	await close();
	console.log(`${checks} checks passed`);
} finally {
	await app.close();
	api.close();
}
