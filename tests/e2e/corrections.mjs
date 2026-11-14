// A real agent run, inside the test fence: the user corrects an answer in Profile settings ("I have
// Power BI" becomes "I do not"), and the agent takes it off what it knows and off the master resume.
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

const sandbox = await createSandbox("corrections", { settings: { onboarded: true, paused: false } });
const now = new Date().toISOString();
// A search is not due, so the only run is the one the correction starts.
await fs.writeFile(path.join(sandbox.userData, "agent.json"), JSON.stringify({ lastSweepAt: now }));
await fs.mkdir(sandbox.workspace, { recursive: true });
await fs.writeFile(
	path.join(sandbox.workspace, "about-me.md"),
	`# About me

## Identity and contact

Rehema Kisanga, Arusha, Tanzania. rehema.kisanga@example.com

## What I am looking for

Finance Officer or Accountant roles in manufacturing, in Arusha.

## Experience

Assistant Accountant, Meru Dairies Ltd, Arusha, Mar 2022 to present. Runs month-end close for two plants, cut from 9 working days to 5.

## Skills

Excel, Sage 300, QuickBooks. Power BI: confirmed by the user, used at Meru Dairies for the monthly sales reports.

## Proof points

Month-end close cut from 9 working days to 5. Asked about results on 14 Nov 2026.
`,
);
await fs.writeFile(
	path.join(sandbox.workspace, "master-resume.json"),
	JSON.stringify({
		contact: { firstName: "Rehema", lastName: "Kisanga", title: "Accountant", email: "rehema.kisanga@example.com" },
		summary: "Accountant with 4 years in food manufacturing, running month-end close for two plants.",
		skills: "- Systems: Sage 300, QuickBooks, Excel\n- Reporting: Power BI, Management accounts",
		workExperience: [
			{
				jobTitle: "Assistant Accountant",
				employer: "Meru Dairies Ltd",
				startDate: "Mar 2022",
				current: true,
				highlights:
					"- Cut month-end close for two plants from 9 working days to 5\n- Built the monthly sales reports in Power BI",
			},
		],
		education: [
			{ schoolName: "University of Dar es Salaam", educationLevel: "Bachelor of Commerce", fieldOfStudy: "Accounting" },
		],
	}),
);
await fs.writeFile(
	path.join(sandbox.workspace, "facts.json"),
	JSON.stringify([
		{
			id: "power-bi",
			at: now,
			question: "Do you have this: Power BI?",
			item: "Power BI",
			category: "skills",
			have: true,
			answer: "I have it. At Meru Dairies, for the monthly sales reports.",
		},
	]),
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
	const facts = await window.evaluate(() =>
		window.desk.facts.correct("power-bi", { answer: "I do not have it.", have: false }),
	);
	check("the correction is saved", facts[0].have === false, facts[0].answer);

	// The corrections of one sitting are gathered for a moment before the run starts.
	const deadline = Date.now() + 12 * 60_000;
	let state = await window.evaluate(() => window.desk.agent.state());
	while (Date.now() < deadline && state.status !== "running") {
		await window.waitForTimeout(2000);
		state = await window.evaluate(() => window.desk.agent.state());
	}
	check("the correction starts a run", state.status === "running", state.runLabel);
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

	const master = await fs.readFile(path.join(sandbox.workspace, "master-resume.json"), "utf8");
	check("Power BI is off the master resume", !/power bi/i.test(master), JSON.parse(master).skills);
	check("what was true stays on it", /9 working days to 5/.test(master) && /Sage 300/.test(master));
	const aboutMe = await fs.readFile(path.join(sandbox.workspace, "about-me.md"), "utf8");
	const claims = aboutMe
		.split("\n")
		.filter((line) => /power bi/i.test(line) && !/\b(not|no|lack|without)\b/i.test(line));
	check("about-me.md no longer says the user has it", claims.length === 0, claims.join(" | "));
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
