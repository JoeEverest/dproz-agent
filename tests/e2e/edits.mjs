// A real agent run, inside the test fence: the user edits their master resume to say they do not have
// Power BI after all, and the agent prepares again the unsent application that claimed it.
// Uses your Claude account.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp } from "./harness.mjs";

// The fence needs one site the agent may reach. Nothing in this run should need it.
const site = http.createServer((_request, response) => {
	response.statusCode = 404;
	response.end("Not found");
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${site.address().port}`;

const sandbox = await createSandbox("edits", { settings: { onboarded: true, paused: false } });
const now = new Date().toISOString();
// A search is not due, so the only run is the one the edit starts.
await fs.writeFile(path.join(sandbox.userData, "agent.json"), JSON.stringify({ lastSweepAt: now }));

const aboutMe = `# About me

## Contact

Rehema S. Kisanga
Arusha, Tanzania · +255 700 000 000 · rehema.kisanga@example.com

## What I am looking for

- Finance Officer or Accountant roles in manufacturing, in Arusha

## Experience

### Assistant Accountant, Meru Dairies Ltd, Arusha (Mar 2022 to present)

- Runs month-end close for two plants. Cut it from 9 working days to 5
- Reconciles 14 bank accounts every month
- Built the monthly sales reports in Power BI

### Audit Associate, Tembo & Partners, Dar es Salaam (Jan 2020 to Feb 2022)

- Led inventory and payables fieldwork on 6 audit engagements

## Education

- Bachelor of Commerce in Accounting, University of Dar es Salaam, 2019

## Skills

- Sage 300, QuickBooks, Excel
- Power BI

## Referees

- Dr. Amani Laizer, Finance Manager, Meru Dairies Ltd, +255 700 000 001, amani.laizer@example.com

## Other facts

- Tanzanian citizen
- Results asked for on 14 Nov 2026

## Do not have

## Standard answers

- Notice: one month
`;
await fs.mkdir(sandbox.workspace, { recursive: true });
await fs.writeFile(path.join(sandbox.workspace, "about-me.md"), aboutMe);

// A card that is prepared and waiting for the user to send it, with a resume that claims Power BI.
const card = "kilele-foods-finance-officer";
const folder = path.join(sandbox.workspace, "applications", card);
await fs.mkdir(folder, { recursive: true });
await fs.writeFile(
	path.join(folder, "job.md"),
	`# Finance Officer, Kilele Foods Ltd, Arusha

Kilele Foods is a food manufacturer in Arusha.

## What you will do

- Run month-end close and bank reconciliations
- Prepare management reports for the finance manager

## What we need

- A degree in accounting or finance
- At least 3 years in accounting, ideally in manufacturing
- Sage 300 or a similar accounting system
- Power BI is an advantage

Apply by email to careers@kilele.example with your resume and a cover letter.
`,
);
await fs.writeFile(
	path.join(folder, "resume.json"),
	JSON.stringify({
		contact: { firstName: "Rehema", lastName: "Kisanga", title: "Accountant", email: "rehema.kisanga@example.com" },
		summary: "Accountant with 6 years in food manufacturing and audit, running month-end close for two plants.",
		skills: "- Systems: Sage 300, QuickBooks, Excel\n- Reporting: Power BI",
		workExperience: [
			{
				jobTitle: "Assistant Accountant",
				employer: "Meru Dairies Ltd",
				startDate: "Mar 2022",
				current: true,
				highlights:
					"- Cut month-end close for two plants from 9 working days to 5\n- Reconcile 14 bank accounts every month\n- Built the monthly sales reports in Power BI",
			},
		],
	}),
);
await fs.writeFile(path.join(folder, "Rehema-Kisanga-Resume.pdf"), "%PDF-1.4");
await fs.writeFile(path.join(folder, "Rehema-Kisanga-Cover-Letter.pdf"), "%PDF-1.4");
await fs.writeFile(
	path.join(folder, "application.json"),
	JSON.stringify({
		id: card,
		title: "Finance Officer",
		company: "Kilele Foods Ltd",
		location: "Arusha",
		status: "ready_to_submit",
		hold: true,
		source: "web",
		applyMethod: "url",
		applyUrl: `${origin}/apply`,
		fit: {
			verdict: "strong",
			summary: "Meets every requirement, including Power BI.",
			strengths: ["Month-end close in manufacturing", "Sage 300", "Power BI"],
			gaps: [],
		},
		strategy: "Lead with the month-end close result. Mention Power BI, which the posting names as an advantage.",
		documents: [
			{ label: "Resume", file: "Rehema-Kisanga-Resume.pdf" },
			{ label: "Cover letter", file: "Rehema-Kisanga-Cover-Letter.pdf" },
		],
		timeline: [{ at: now, event: "Found" }],
		createdAt: now,
		updatedAt: now,
	}),
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
	// The user's edit: Power BI comes off the job and the skills, and goes under Do not have.
	const edited = aboutMe
		.replace("- Built the monthly sales reports in Power BI\n", "")
		.replace("- Sage 300, QuickBooks, Excel\n- Power BI\n", "- Sage 300, QuickBooks, Excel\n")
		.replace("## Do not have\n", "## Do not have\n\n- Power BI\n");
	const result = await window.evaluate(([text, base]) => window.desk.profile.write(text, base), [edited, aboutMe]);
	check("the edit is saved", result.saved === true);

	// The edits of one sitting are gathered for a moment before the run starts.
	const deadline = Date.now() + 20 * 60_000;
	let state = await window.evaluate(() => window.desk.agent.state());
	while (Date.now() < deadline && state.status !== "running") {
		await window.waitForTimeout(2000);
		state = await window.evaluate(() => window.desk.agent.state());
	}
	check("the edit starts a run", state.status === "running", state.runLabel);
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

	const resume = await fs.readFile(path.join(folder, "resume.json"), "utf8");
	check("the application's resume no longer claims Power BI", !/power bi/i.test(resume), JSON.parse(resume).skills);
	check("what is still true stays on it", /9 working days to 5/.test(resume) && /Sage 300/.test(resume));
	const after = await fs.readFile(path.join(sandbox.workspace, "about-me.md"), "utf8");
	const claims = after.slice(0, after.indexOf("## Do not have")).match(/power bi/gi) ?? [];
	check(
		"the agent did not put back what the user took out",
		claims.length === 0 && /## Do not have\s+- Power BI/.test(after),
	);
	const [saved] = await window.evaluate(() => window.desk.applications.list());
	check(
		"the card is prepared again, not sent",
		["ready_to_submit", "needs_input"].includes(saved.status),
		saved.status,
	);
	check(
		"its fit check no longer counts Power BI as a strength",
		!saved.fit.strengths.some((item) => /power bi/i.test(item)),
	);
} catch (error) {
	check("no harness error", false, error.stack);
} finally {
	await window.evaluate(() => window.desk.agent.setPaused(true)).catch(() => {});
	await app.close().catch(() => {});
	site.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
