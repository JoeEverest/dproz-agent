// A real agent run, inside the test fence: the user pastes two job links at once. One job takes
// applications through a website and is sent; the other only takes email, so it is prepared for the
// user to send. What the app reports as usage is collected here and checked, and goes nowhere else.
// Uses your Claude account.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerFor, hasItem } from "./fixtures.mjs";
import { createSandbox, launchApp, shot, snapshotApp } from "./harness.mjs";
import { startMockAts } from "./mock-ats.mjs";

const LIMIT_MS = Number(process.env.E2E_LIMIT_MIN ?? 40) * 60_000;
const started = Date.now();
const log = (...parts) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s]`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const check = (name, passed, detail = "") => {
	checks.push({ name, passed: Boolean(passed) });
	log(passed ? "PASS" : "FAIL", name, detail);
};

// Stands in for PostHog.
const reported = [];
const sink = http.createServer((request, response) => {
	let body = "";
	request.on("data", (chunk) => {
		body += chunk;
	});
	request.on("end", () => {
		if (request.url.startsWith("/batch")) reported.push(...JSON.parse(body).batch);
		response.setHeader("content-type", "application/json");
		response.end('{"status":1}');
	});
});
await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));

const sandbox = await createSandbox("addjob", { settings: { onboarded: true, paused: false } });
// A search is not due, so the only run is the one the links start.
await fs.writeFile(
	path.join(sandbox.userData, "agent.json"),
	JSON.stringify({ lastSweepAt: new Date().toISOString() }),
);
const here = path.dirname(fileURLToPath(import.meta.url));
await fs.copyFile(path.join(here, "persona-about-me.md"), path.join(sandbox.workspace, "about-me.md"));

const ats = await startMockAts({ submissionsFile: path.join(sandbox.base, "submissions.json") });
const links = [`${ats.origin}/jobs/finance-officer`, `${ats.origin}/postings/accountant`];
const { app, window } = await launchApp(
	sandbox,
	{
		DPROZ_AGENT_HEADLESS: "1",
		DPROZ_AGENT_TEST_ORIGIN: ats.origin,
		DPROZ_API_URL: `${ats.origin}/api`,
		DPROZ_SITE_URL: ats.origin,
		DPROZ_AGENT_POSTHOG_KEY: "phc_test",
		DPROZ_AGENT_POSTHOG_HOST: `http://127.0.0.1:${sink.address().port}`,
	},
	await snapshotApp("addjob"),
);

const agentState = () => window.evaluate(() => window.desk.agent.state());
const applications = () => window.evaluate(() => window.desk.applications.list());
const asked = [];

async function attend() {
	const banner = window.getByRole("alert").filter({ hasText: "needs you in its browser" });
	if (await banner.count()) {
		log("help requested:", await banner.locator("p").nth(1).textContent());
		await fetch(`${ats.origin}/__test/verify`, { method: "POST" });
		await banner.getByRole("button", { name: "I've done it" }).click();
	}
	const nav = (name) => window.getByRole("navigation").getByRole("button", { name });
	if (!(await nav(/^Questions \(\d+\)$/).count())) return;
	await nav(/^Questions/).click();
	const box = window.locator("#agent-panel textarea:not([disabled])");
	const choice = window.locator("#agent-panel form fieldset");
	while ((await box.count()) || (await choice.count())) {
		if (await choice.count()) {
			const item = await choice.locator("legend span").last().textContent();
			asked.push(`quick: ${item}`);
			await choice.getByRole("button", { name: hasItem(item ?? "") ? /^I have it/ : /^Not yet/ }).click();
		} else {
			const question = await box.getAttribute("aria-label");
			asked.push(`typed: ${question}`);
			await box.fill(answerFor(question ?? ""));
			await box.press("ControlOrMeta+Enter");
		}
		await sleep(900);
	}
	await nav("Jobs").click();
}

const settled = (card) => ["applied", "manual", "closed"].includes(card.status);

try {
	await window.getByRole("heading", { name: "Jobs", exact: true }).waitFor({ timeout: 30_000 });
	await window.getByRole("button", { name: "Add a job" }).click();
	await window.getByRole("textbox", { name: "Job links or posting" }).fill(links.join("\n"));
	await shot(window, "addjob-1-links");
	await window.getByRole("button", { name: "Apply for me" }).click();
	log("two links handed to the agent");

	let cards = [];
	let idleRounds = 0;
	while (Date.now() - started < LIMIT_MS) {
		await attend();
		cards = await applications();
		const state = await agentState();
		idleRounds = state.status === "idle" && state.queued === 0 ? idleRounds + 1 : 0;
		if (cards.length >= 2 && cards.every(settled) && idleRounds > 1) break;
		if (idleRounds > 12) break;
		await sleep(4000);
	}
	await shot(window, "addjob-2-board");
	for (const card of cards) log(`card: ${card.title} at ${card.company} → ${card.status} (${card.applyMethod})`);
	for (const question of asked) log(`  ${question}`);

	check("each link became one card, and nothing else was searched for", cards.length === 2, `${cards.length} cards`);
	const form = cards.find((card) => /kilele/i.test(card.company));
	const email = cards.find((card) => /mlima/i.test(card.company));
	const submissions = JSON.parse(
		await fs.readFile(path.join(sandbox.base, "submissions.json"), "utf8").catch(() => "[]"),
	);
	check(
		"the job with a website form was applied for",
		form?.status === "applied" && submissions.length === 1,
		`${form?.status}, ${submissions.length} submission(s)`,
	);
	const prepared = await Promise.all(
		(email?.documents ?? []).map((document) =>
			fs
				.readFile(path.join(sandbox.workspace, "applications", email.id, document.file))
				.then((file) => file.subarray(0, 4).toString() === "%PDF")
				.catch(() => false),
		),
	);
	check(
		"the job that only takes email was prepared for the user to send: resume, cover letter and the email",
		email?.status === "manual" &&
			email.applyMethod === "email" &&
			/careers@mlima-traders\.example/.test(email.emailDraft?.to ?? "") &&
			Boolean(email.emailDraft?.subject && email.emailDraft?.body) &&
			prepared.length >= 2 &&
			prepared.every(Boolean),
		`${email?.status}, to ${email?.emailDraft?.to}, ${prepared.length} document(s)`,
	);
	check(
		"nothing was sent for the email job",
		submissions.every((entry) => !/mlima/i.test(JSON.stringify(entry))),
	);
	if (email) {
		await window
			.getByRole("button", { name: new RegExp(email.title) })
			.first()
			.click();
		await sleep(800);
		await shot(window, "addjob-3-email-card");
		await window.keyboard.press("Escape");
	}

	// What was reported.
	for (let waited = 0; waited < 25 && !reported.some((item) => item.event === "run finished"); waited++)
		await sleep(1000);
	const of = (name) => reported.filter((item) => item.event === name).map((item) => item.properties);
	for (const item of reported) {
		const { distinct_id, $lib, $process_person_profile, app_version, platform, arch, auto_submit, ...rest } =
			item.properties;
		log(`event: ${item.event} ${JSON.stringify(rest)}`);
	}
	const runs = of("run finished").filter((run) => run.kind === "add_job");
	const cost = runs.reduce((sum, run) => sum + (run.cost_usd ?? 0), 0);
	check(
		"adding the jobs is reported, as two links",
		of("job added")[0]?.links === 2 && of("job added")[0]?.prepare_only === false,
	);
	check(
		"the run is reported with what it cost, how long it took and the models it used",
		runs.length >= 1 &&
			cost > 0 &&
			runs[0].duration_s > 0 &&
			runs[0].models.length > 0 &&
			runs[0].outcome === "success",
		`$${cost.toFixed(2)} over ${runs.length} run(s), ${runs[0]?.models.join(", ")}`,
	);
	check(
		"each model's share of the spending is reported",
		of("model used").length >= 1 && of("model used").every((model) => model.used_model && model.cost_usd >= 0),
	);
	const steps = of("application step");
	const stepCost = steps.reduce((sum, step) => sum + (step.cost_usd ?? 0), 0);
	const total = of("run finished").reduce((sum, run) => sum + (run.cost_usd ?? 0), 0);
	check(
		"every step is reported with its outcome and its share of the cost: written, judged and sent",
		["write", "judge", "send"].every((name) => steps.some((step) => step.step === name && step.cost_usd > 0)) &&
			steps.every((step) => step.outcome !== "UNKNOWN" && step.application) &&
			steps.some((step) => step.step === "send" && step.outcome === "APPLIED") &&
			steps.some((step) => step.step === "write" && step.outcome === "MANUAL") &&
			stepCost > 0 &&
			stepCost <= total + 0.001,
		steps.map((step) => `${step.step}:${step.outcome}:$${(step.cost_usd ?? 0).toFixed(2)}`).join(" "),
	);
	const done = of("application completed");
	const sent = done.find((item) => item.outcome === "applied");
	const emailed = done.find((item) => item.outcome === "manual");
	check(
		"each finished application is reported with its total cost and how it is sent",
		sent?.apply_method === "url" &&
			sent.cost_usd > 0 &&
			sent.apply_host === "127.0.0.1" &&
			emailed?.apply_method === "email" &&
			emailed.cost_usd > 0 &&
			done.every((item) => item.added_by_user === true),
		`website $${sent?.cost_usd}, email $${emailed?.cost_usd}`,
	);
	const everything = JSON.stringify(reported);
	const leaked = [
		"Rehema",
		"Kisanga",
		"Kilele",
		"Mlima",
		"Finance Officer",
		"Accountant",
		"Meru",
		"example.com",
	].filter((text) => everything.includes(text));
	check("nothing reported names the user, a job or an employer", leaked.length === 0, leaked.join(", "));
} catch (error) {
	check("no harness error", false, error.stack);
	await shot(window, "addjob-failure").catch(() => {});
} finally {
	await app.close().catch(() => {});
	await ats.close?.();
	sink.close();
	const passed = checks.filter((entry) => entry.passed).length;
	log(`RESULT ${passed}/${checks.length} checks passed`);
	process.exit(passed === checks.length ? 0 : 1);
}
