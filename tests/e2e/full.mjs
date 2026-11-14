import fs from "node:fs/promises";
import path from "node:path";
import { answerFor, writePersonaDocuments } from "./fixtures.mjs";
import { createSandbox, launchApp, shot, snapshotApp } from "./harness.mjs";
import { startMockAts } from "./mock-ats.mjs";

const RUN_LIMIT_MS = Number(process.env.E2E_LIMIT_MIN ?? 60) * 60_000;
const started = Date.now();
const log = (...parts) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s]`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const check = (name, passed, detail = "") => {
	checks.push({ name, passed: Boolean(passed), detail });
	log(passed ? "PASS" : "FAIL", name, detail);
};

const sandbox = await createSandbox("full", { settings: { paused: false } });
const ats = await startMockAts({ submissionsFile: path.join(sandbox.base, "submissions.json") });
const sources = await writePersonaDocuments(path.join(sandbox.base, "persona"));
const appRoot = await snapshotApp("full");
const { app, window } = await launchApp(
	sandbox,
	{
		DPROZ_AGENT_HEADLESS: "1",
		DPROZ_AGENT_TEST_ORIGIN: ats.origin,
		DPROZ_API_URL: `${ats.origin}/api`,
		DPROZ_SITE_URL: ats.origin,
	},
	appRoot,
);
log("app launched; mock portal and jobs API at", ats.origin);

const agentState = () => window.evaluate(() => window.desk.agent.state());
const applications = () => window.evaluate(() => window.desk.applications.list());
const readWorkspace = (file) => fs.readFile(path.join(sandbox.workspace, file), "utf8").catch(() => "");
let handOffs = 0;
let liveCards = 0;

async function attend() {
	const banner = window.getByRole("alert").filter({ hasText: "needs you in its browser" });
	if (await banner.count()) {
		log("help requested:", await banner.locator("p").nth(1).textContent());
		await shot(window, "help-banner");
		await fetch(`${ats.origin}/__test/verify`, { method: "POST" });
		await banner.getByRole("button", { name: "I've done it" }).click();
		handOffs++;
	}

	const nav = (name) => window.getByRole("navigation").getByRole("button", { name });
	const waiting = await nav(/^Questions \(\d+\)$/).count();
	if (waiting) await nav(/^Questions/).click();
	const box = window.locator("#agent-panel textarea[placeholder='Your answer']");
	while (await box.count()) {
		const question = await box.getAttribute("aria-label");
		const answer = answerFor(question ?? "");
		log("answering:", question, "→", answer);
		if (!liveCards) await shot(window, "question");
		await box.fill(answer);
		await box.press("ControlOrMeta+Enter");
		await sleep(900);
	}

	if (waiting) await nav("Jobs").click();
	const state = await agentState();
	const working = Object.keys(state.active).length;
	if (working > liveCards) {
		liveCards = working;
		await shot(window, `live-${working}`);
	}
}

async function until(label, isDone) {
	let idleRounds = 0;
	while (Date.now() - started < RUN_LIMIT_MS) {
		await attend();
		if (await isDone()) return true;
		const state = await agentState();
		idleRounds = state.status === "idle" && state.queued === 0 ? idleRounds + 1 : 0;
		if (idleRounds > 12) {
			log(label, "agent idle for a while without reaching the goal");
			return false;
		}
		await sleep(4000);
	}
	log(label, "timed out");
	return false;
}

try {
	await window.getByRole("heading", { name: "Set up your job-search agent" }).waitFor();
	await window.evaluate((paths) => window.desk.documents.add(paths), sources);
	const begin = window.getByRole("button", { name: "Start", exact: true });
	for (let waited = 0; waited < 60 && (await begin.isDisabled()); waited++) await sleep(1000);
	await shot(window, "setup-ready");
	await begin.click();
	log("setup finished; the agent is on its own from here");

	const finished = await until("autonomous run", async () => {
		const state = await agentState();
		const cards = await applications();
		return (
			state.status === "idle" &&
			state.queued === 0 &&
			ats.submissions.length > 0 &&
			cards.some((card) => card.status === "applied") &&
			cards.some((card) => card.status === "manual")
		);
	});

	const aboutMe = await readWorkspace("about-me.md");
	check("the profile was written from the documents", /Kisanga/.test(aboutMe) && /Meru Dairies/.test(aboutMe));
	check("answers given in the panel were saved to the profile", /2,?800,?000/.test(aboutMe));
	check("the agent searched and applied without being asked", finished);

	const cards = await applications();
	log("board:", cards.map((card) => `${card.title} @ ${card.company}: ${card.status}`).join(" | "));
	const applied = cards.find((card) => /finance officer/i.test(card.title));
	const byEmail = cards.find((card) => /mlima/i.test(card.company));
	const unsuitable = cards.find((card) => /neurosurgeon/i.test(card.title));
	check(
		"the website job was applied to",
		applied?.status === "applied" && ats.submissions.length === 1,
		`${ats.submissions.length} submissions`,
	);
	check(
		"the email-only job was prepared for the user to send",
		byEmail?.status === "manual" &&
			Boolean(byEmail?.emailDraft?.to?.includes("mlima-traders")) &&
			byEmail.documents.length >= 2,
		byEmail?.status,
	);
	check(
		"the unsuitable job was not pursued",
		!unsuitable || unsuitable.status === "closed",
		unsuitable?.status ?? "no card",
	);
	check(
		"each prepared card has a fit check and a strategy",
		[applied, byEmail].every((card) => card?.fit && card?.strategy),
	);

	const activity = await window.evaluate(() => window.desk.agent.activity());
	const delegated = (verb) =>
		activity.filter((item) => item.kind === "tool" && item.summary.startsWith(`${verb}:`)).length;
	check("writer subagents prepared the applications", delegated("Preparing") >= 2, `${delegated("Preparing")} writers`);
	check("judge subagents reviewed them", delegated("Judging") >= 1, `${delegated("Judging")} judges`);
	check("a sender subagent submitted", delegated("Sending") >= 1, `${delegated("Sending")} senders`);
	check("several cards were worked on at once", liveCards >= 2, `${liveCards} at peak`);
	check("the verification step was handed to the user", handOffs >= 1);

	const submission = ats.submissions[0];
	if (submission) {
		log("submission:", JSON.stringify(submission.fields));
		check(
			"submitted name and email are the candidate's",
			/Kisanga/.test(submission.fields.fullName) && submission.fields.email === "rehema.kisanga@example.com",
		);
		check("a PDF resume was uploaded", submission.files.resume?.isPdf, submission.files.resume?.filename);
		check("the driving licence answer is the user's", submission.fields.drivingLicence === "yes");
		check("the salary is the user's figure", /2,?800,?000/.test(submission.fields.salary), submission.fields.salary);
		check(
			"the experience bracket is truthful (4-6 years)",
			submission.fields.experience === "4-6",
			submission.fields.experience,
		);
	}
	if (applied) {
		const folder = path.join(sandbox.workspace, "applications", applied.id);
		const files = await fs.readdir(folder);
		log("application folder:", files.join(", "));
		check("the posting was saved", files.includes("job.md"));
		const listed = await Promise.all(
			applied.documents.map((document) =>
				fs.access(path.join(folder, document.file)).then(
					() => true,
					() => false,
				),
			),
		);
		check(
			"the documents sent are listed on the card and exist",
			applied.documents.length >= 2 && listed.every(Boolean),
			applied.documents.map((document) => document.file).join(", "),
		);
	}
	const logins = await window.evaluate(() => window.desk.credentials.list());
	check(
		"the portal account it created was saved to logins",
		logins.some((login) => login.site.includes("127.0.0.1")),
	);
	const state = await agentState();
	check(
		"the next search is scheduled",
		Boolean(state.nextSweepAt) && Date.parse(state.nextSweepAt) > Date.now(),
		state.nextSweepAt,
	);

	await shot(window, "board-final");
	if (applied) {
		await window
			.getByRole("button", { name: /Finance Officer/ })
			.first()
			.click();
		await window.getByRole("dialog").waitFor();
		await sleep(900);
		await shot(window, "drawer-final");
	}
} catch (error) {
	check("scenario ran without a harness error", false, error.stack);
	await shot(window, "failure").catch(() => {});
} finally {
	const failed = checks.filter((entry) => !entry.passed);
	log(`RESULT ${checks.length - failed.length}/${checks.length} checks passed`);
	for (const entry of failed) log("FAILED:", entry.name, entry.detail);
	await fs.writeFile(path.join(sandbox.base, "result.json"), JSON.stringify({ checks, events: ats.events }, null, 2));
	await window.evaluate(() => window.desk.agent.setPaused(true)).catch(() => {});
	await app.close().catch(() => {});
	await ats.close();
	process.exit(failed.length ? 1 : 0);
}
