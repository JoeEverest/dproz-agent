import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { writePersonaDocuments } from "./fixtures.mjs";
import { createSandbox, shot } from "./harness.mjs";
import { startMockAts } from "./mock-ats.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath =
	process.env.DPROZ_AGENT_APP ??
	{
		darwin: path.join(root, `dist/mac-${process.arch}/Dproz Agent.app/Contents/MacOS/Dproz Agent`),
		linux: path.join(root, "dist/linux-unpacked/dproz-agent"),
	}[process.platform];

const aboutMe = `# About me

## Identity and contact
Rehema S. Kisanga, Arusha, Tanzania. +255 700 000 000, rehema.kisanga@example.com. Tanzanian citizen. Class B driving licence valid to 2029.

## What I am looking for
Finance Officer or Accountant roles in manufacturing or FMCG, in Arusha. TZS 2,800,000 gross per month. One month's notice.

## Experience
Assistant Accountant, Meru Dairies Ltd, Arusha, March 2022 to present: month-end close for two plants (cut from 9 working days to 5); 14 bank accounts reconciled monthly; creditors ledger of about 220 suppliers; VAT, PAYE and SDL returns with no penalties in three years; inventory variance cut from 4.1% to 1.3%; management accounts in Excel and Sage 300.
Audit Associate, Tembo & Partners, Dar es Salaam, January 2020 to February 2022: audits of manufacturing and NGO clients up to TZS 18 billion revenue.

## Education and certifications
Bachelor of Commerce in Accounting, University of Dar es Salaam, 2019 (Upper Second). CPA(T) Intermediate passed, NBAA, November 2023; final level in progress.

## Skills
Excel (pivot tables, Power Query), Sage 300, QuickBooks, Tally. English and Swahili, fluent.
`;

const sandbox = await createSandbox("packaged", { settings: { onboarded: true, paused: false } });
const ats = await startMockAts({ submissionsFile: path.join(sandbox.base, "submissions.json") });
await writePersonaDocuments(path.join(sandbox.workspace, "documents"));
await fs.writeFile(path.join(sandbox.workspace, "about-me.md"), aboutMe);
await fs.writeFile(
	path.join(sandbox.userData, "agent.json"),
	JSON.stringify({ lastSweepAt: new Date().toISOString() }),
);

const app = await electron.launch({
	executablePath,
	env: {
		...process.env,
		DPROZ_AGENT_USER_DATA: sandbox.userData,
		DPROZ_AGENT_BROWSERS_PATH: process.env.DPROZ_AGENT_BROWSERS_PATH,
		DPROZ_AGENT_NO_TRAY: "1",
		DPROZ_AGENT_QUIET_WINDOW: "1",
		DPROZ_AGENT_HEADLESS: "1",
		DPROZ_AGENT_TEST_ORIGIN: ats.origin,
		DPROZ_API_URL: `${ats.origin}/api`,
		DPROZ_SITE_URL: ats.origin,
	},
});
const window = await app.firstWindow();
const results = [];
const check = (name, passed, detail = "") => {
	results.push(Boolean(passed));
	console.log(passed ? "PASS" : "FAIL", name, detail);
};

try {
	await window.getByRole("heading", { name: "Jobs", exact: true }).waitFor({ timeout: 30_000 });
	check("the packaged app starts", await app.evaluate(({ app: electronApp }) => electronApp.isPackaged));
	const setup = await window.evaluate(() => window.desk.setup.status());
	check("Claude sign-in is detected by the bundled binary", setup.claude.signedIn);
	check("the browser install is detected", setup.browserInstalled);
	check("credential storage is encrypted", setup.credentialStorage.encrypted, setup.credentialStorage.backend);
	const idle = await window.evaluate(() => window.desk.agent.state());
	check("no search starts before the next one is due", idle.status === "idle" && Boolean(idle.nextSweepAt));

	await window.getByRole("button", { name: "Add a job" }).click();
	await window.getByRole("textbox", { name: "Job link or posting" }).fill(`${ats.origin}/jobs/finance-officer`);
	await window.getByRole("button", { name: "Prepare only" }).click();

	const deadline = Date.now() + 25 * 60_000;
	let cards = [];
	let state = { status: "running" };
	while (Date.now() < deadline) {
		await window.waitForTimeout(5000);
		state = await window.evaluate(() => window.desk.agent.state());
		cards = await window.evaluate(() => window.desk.applications.list());
		if (state.status === "idle" && cards.length > 0) break;
	}
	const card = cards[0];
	const activity = await window.evaluate(() => window.desk.agent.activity());
	const errors = activity.filter((item) => item.kind === "notice" && item.tone === "error").map((item) => item.text);
	check("the run finished without errors", state.status === "idle" && errors.length === 0, errors.join("; "));
	check("the added job got a card", Boolean(card), cards.map((entry) => `${entry.title}:${entry.status}`).join(", "));
	check(
		"it was prepared but held back from sending",
		card?.status === "ready_to_submit" && card?.hold === true && ats.submissions.length === 0,
		`${card?.status} hold=${card?.hold}`,
	);
	const folder = path.join(sandbox.workspace, "applications", card?.id ?? "");
	const files = card ? await fs.readdir(folder) : [];
	check(
		"tailored PDFs were rendered and listed on the card",
		(card?.documents.length ?? 0) >= 2 && files.filter((file) => file.endsWith(".pdf")).length >= 2,
		files.join(", "),
	);
	check(
		"writer and judge subagents ran",
		["Preparing:", "Judging:"].every((verb) =>
			activity.some((item) => item.kind === "tool" && item.summary.startsWith(verb)),
		),
	);
	await shot(window, "packaged");
} catch (error) {
	check("no harness error", false, error.stack);
} finally {
	await window.evaluate(() => window.desk.agent.setPaused(true)).catch(() => {});
	await app.close().catch(() => {});
	await ats.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
