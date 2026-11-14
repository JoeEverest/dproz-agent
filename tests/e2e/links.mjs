// A real agent run, inside the test fence: the user adds a link to a page about themselves, and the
// agent reads the page and writes what it learned into about-me.md. Uses your Claude account.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp } from "./harness.mjs";

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Rehema Kisanga | Portfolio</title></head>
<body>
<h1>Rehema Kisanga</h1>
<p>Accountant in Arusha, Tanzania.</p>
<h2>Selected work</h2>
<ul>
<li>Built the costing model for the Kilimanjaro Coffee Cooperative, covering 412 smallholder farmers.</li>
<li>Speaker at the 2025 Arusha Finance Forum on stock variance in dairy plants.</li>
</ul>
</body>
</html>`;

// The only site the fenced agent may open. It is the page, and nothing else.
const site = http.createServer((request, response) => {
	if (request.url.startsWith("/portfolio")) {
		response.setHeader("content-type", "text/html; charset=utf-8");
		response.end(page);
		return;
	}
	response.statusCode = 404;
	response.end("Not found");
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${site.address().port}`;

const sandbox = await createSandbox("links", { settings: { onboarded: true, paused: false } });
// A search is not due, so the only run is the one the link starts.
await fs.writeFile(
	path.join(sandbox.userData, "agent.json"),
	JSON.stringify({ lastSweepAt: new Date().toISOString() }),
);
const { app, window } = await launchApp(sandbox, {
	DPROZ_AGENT_HEADLESS: "1",
	DPROZ_AGENT_TEST_ORIGIN: origin,
	DPROZ_API_URL: `${origin}/api`,
	DPROZ_SITE_URL: origin,
});

const results = [];
const check = (name, passed, detail = "") => {
	results.push(Boolean(passed));
	console.log(passed ? "PASS" : "FAIL", name, detail);
};

try {
	await window.getByRole("heading", { name: "Jobs", exact: true }).waitFor({ timeout: 30_000 });
	const added = await window.evaluate((link) => window.desk.documents.addLink(link), `${origin}/portfolio`);
	check("the page is kept as a link", added.added?.kind === "link", JSON.stringify(added.added));
	await window.evaluate((link) => window.desk.agent.linksAdded([link]), `${origin}/portfolio`);

	const deadline = Date.now() + 10 * 60_000;
	let state = await window.evaluate(() => window.desk.agent.state());
	check("the link starts a run", state.status === "running", state.runLabel);
	while (Date.now() < deadline && state.status !== "idle") {
		await window.waitForTimeout(3000);
		state = await window.evaluate(() => window.desk.agent.state());
	}
	const activity = await window.evaluate(() => window.desk.agent.activity());
	const errors = activity.filter((item) => item.kind === "notice" && item.tone === "error").map((item) => item.text);
	check("the run finished without errors", state.status === "idle" && errors.length === 0, errors.join("; "));
	console.log(
		activity
			.filter((item) => item.kind === "tool")
			.map((item) => `  ${item.summary}`)
			.join("\n"),
	);
	const aboutMe = await fs.readFile(path.join(sandbox.workspace, "about-me.md"), "utf8");
	check(
		"what the page says is in about-me.md",
		aboutMe.includes("Kilimanjaro Coffee Cooperative") && aboutMe.includes("412"),
		aboutMe.split("\n").find((line) => line.includes("Kilimanjaro")) ?? "not found",
	);
	const cards = await window.evaluate(() => window.desk.applications.list());
	check("no job search ran", cards.length === 0);
} catch (error) {
	check("no harness error", false, error.stack);
} finally {
	await window.evaluate(() => window.desk.agent.setPaused(true)).catch(() => {});
	await app.close().catch(() => {});
	site.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
