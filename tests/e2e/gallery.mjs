import fs from "node:fs/promises";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

const day = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();

const base = (id, title, company, status, extra = {}) => ({
	id,
	title,
	company,
	location: "Arusha, Tanzania",
	employmentType: "Full-Time",
	source: "dproz",
	applyMethod: "url",
	status,
	documents: [],
	questions: [],
	timeline: [{ at: iso(-2), event: "Found" }],
	createdAt: iso(-2),
	updatedAt: iso(-1),
	...extra,
});

const fit = {
	verdict: "strong",
	summary:
		"Five years in food-manufacturing finance covers every core duty. The only gap is the final CPA(T) level, which is in progress.",
	strengths: [
		"Cut month-end close from 9 working days to 5",
		"TRA filings for three years with no penalties",
		"Sage 300 and advanced Excel",
	],
	gaps: ["CPA(T) final level still in progress"],
};

const strategy = `**Who reads it:** the Finance Manager, who needs month-end to stop slipping.\n\n**Lead with** the close going from 9 days to 5 across two plants, then the inventory variance falling from 4.1% to 1.3%.\n\n- Mirror their words: *creditors ledger*, *management accounts*, *variance analysis*.\n- Address CPA(T) directly: intermediate passed, finals booked.\n- Leave out the NGO audit work; it dilutes the manufacturing story.`;

const documents = [
	{ label: "Resume", file: "Rehema-Kisanga-Resume.pdf" },
	{ label: "Cover letter", file: "Rehema-Kisanga-Cover-Letter.pdf" },
];

const applications = [
	base("kilele-foods-finance-officer", "Finance Officer", "Kilele Foods Ltd", "applied", {
		fit,
		strategy,
		documents,
		closesAt: iso(12),
		jobUrl: "https://careers.example.com/jobs/finance-officer",
		timeline: [
			{ at: iso(-2), event: "Found" },
			{ at: iso(-1.5), event: "Moved to Ready to submit" },
			{ at: iso(-1), event: "Submitted on the careers portal. Reference KF-1042." },
			{ at: iso(-1), event: "Moved to Applied" },
		],
	}),
	base("mawe-cement-management-accountant", "Management Accountant", "Mawe Cement", "applied", {
		fit: { ...fit, verdict: "good" },
		documents,
	}),
	base(
		"pwani-bank-senior-accountant",
		"Senior Accountant, Financial Reporting",
		"Pwani Commercial Bank",
		"needs_input",
		{
			fit: { ...fit, verdict: "stretch" },
			closesAt: iso(2),
			location: "Dar es Salaam, Tanzania",
			questions: [
				{
					id: "q1",
					question: "Have you prepared IFRS 9 expected credit loss reports, and if so for which employer?",
					why: "The form has a required question on IFRS 9 experience.",
					askedAt: iso(-0.2),
				},
				{ id: "q2", question: "Would you move to Dar es Salaam for this role?", askedAt: iso(-0.2) },
			],
		},
	),
	base("jazia-b2b-finance-associate", "Finance Associate", "Jazia", "manual", {
		fit: { ...fit, verdict: "good" },
		applyMethod: "email",
		applyEmail: "contact@jazia.example",
		closesAt: iso(5),
		documents,
		emailDraft: {
			to: "contact@jazia.example",
			subject: "Application: Finance Associate (Rehema Kisanga)",
			body: "Dear Hiring Team,\n\nPlease find attached my CV and cover letter for the Finance Associate role.\n\nAt Meru Dairies I cut month-end close from nine working days to five and I would like to bring the same discipline to Jazia.\n\nKind regards,\nRehema Kisanga\n+255 700 000 000",
		},
	}),
	base(
		"simba-telecom-finance-analyst",
		"Finance Business Partner: Commercial Analytics and Planning",
		"Simba Telecom",
		"found",
		{ closesAt: iso(9), location: "Dar es Salaam, Tanzania" },
	),
	base("kibo-bottlers-cost-accountant", "Cost Accountant", "Kibo Bottlers", "found", {
		fit: { ...fit, verdict: "strong" },
		closesAt: iso(20),
	}),
	base("bahari-media-accounts-officer", "Accounts Officer", "Bahari Media", "ready_to_submit", {
		fit: { ...fit, verdict: "good" },
		documents,
		closesAt: iso(6),
	}),
	base("tumaini-bank-graduate-trainee", "Graduate Trainee, Finance", "Tumaini Bank", "closed", {
		fit: { ...fit, verdict: "poor", gaps: ["Open only to 2025 and 2026 graduates"] },
		closedReason: "The programme only accepts people who graduated in 2025 or 2026. You graduated in 2019.",
	}),
	base("meru-agro-finance-manager", "Finance Manager", "Meru Agro", "interview", { fit, documents }),
];

const activity = [
	{ id: "a1", at: iso(-0.02), kind: "notice", tone: "info", text: "Looking for jobs." },
	{
		id: "a2",
		at: iso(-0.02),
		kind: "tool",
		tool: "get_answers",
		summary: "Check for your answers",
		state: "done",
		subagent: false,
	},
	{
		id: "a3",
		at: iso(-0.02),
		kind: "tool",
		tool: "search_jobs",
		summary: 'Search Dproz for "accountant"',
		state: "done",
		subagent: false,
	},
	{
		id: "a5",
		at: iso(-0.02),
		kind: "assistant",
		text: "Six jobs posted since this morning are worth pursuing. Preparing all six now.",
		subagent: false,
	},
	{
		id: "a6",
		at: iso(-0.019),
		kind: "tool",
		tool: "Agent",
		summary: "Preparing: Finance Officer at Kilele Foods",
		state: "done",
		subagent: false,
	},
	{
		id: "a7",
		at: iso(-0.019),
		kind: "tool",
		tool: "Agent",
		summary: "Preparing: Cost Accountant at Kibo Bottlers",
		detail: "Render Rehema-Kisanga-Resume.pdf",
		state: "running",
		subagent: false,
	},
	{
		id: "a8",
		at: iso(-0.019),
		kind: "tool",
		tool: "Agent",
		summary: "Preparing: Finance Associate at Jazia",
		state: "done",
		subagent: false,
	},
	{
		id: "a9",
		at: iso(-0.017),
		kind: "tool",
		tool: "Agent",
		summary: "Judging: Finance Officer at Kilele Foods",
		state: "done",
		subagent: false,
	},
	{
		id: "a10",
		at: iso(-0.016),
		kind: "tool",
		tool: "Agent",
		summary: "Sending: Finance Officer at Kilele Foods",
		state: "done",
		subagent: false,
	},
	{
		id: "a14",
		at: iso(-0.014),
		kind: "assistant",
		text: "**Sent:** Finance Officer at Kilele Foods (reference KF-1042).\n\n**Waiting on you:** two questions on the Pwani Commercial Bank card.\n\n**Yours to send:** Jazia only takes email; the draft and attachments are ready.",
		subagent: false,
	},
	{ id: "a15", at: iso(-0.014), kind: "notice", tone: "success", text: "Finished in about 14 min." },
];

const sandbox = await createSandbox("gallery", { settings: { onboarded: true, paused: true } });
for (const application of applications) {
	const folder = path.join(sandbox.workspace, "applications", application.id);
	await fs.mkdir(folder, { recursive: true });
	await fs.writeFile(path.join(folder, "application.json"), JSON.stringify(application, null, "\t"));
	for (const document of application.documents)
		await fs.writeFile(path.join(folder, document.file), "%PDF-1.4 placeholder");
}
const aboutMe = `# Rehema Kisanga

Accountant with five years in food-manufacturing finance, based in Arusha.

## Looking for
- Finance Officer, Accountant or Management Accountant roles
- Arusha first; open to Dar es Salaam for the right role
- Full-time, from TZS 2,400,000 gross a month

## Experience
- **Kilimo Foods, Finance Officer (2021 to now):** cut month-end close from 9 working days to 5 across two plants.
- **Arusha Dairy, Accounts Assistant (2019 to 2021):** creditors ledger and TRA filings, three years with no penalties.

## Qualifications
- BCom Accounting, University of Dar es Salaam, 2019
- CPA(T) intermediate passed; final level booked

## Tools
Sage 300, advanced Excel, QuickBooks
`;
await fs.writeFile(path.join(sandbox.workspace, "about-me.md"), aboutMe);
await fs.mkdir(path.join(sandbox.workspace, "documents"), { recursive: true });
for (const [name, size] of [
	["Rehema Kisanga - Resume.pdf", 184_000],
	["CPA(T) Intermediate Certificate.pdf", 412_000],
	["BCom Transcript.pdf", 268_000],
	["Reference - Kilimo Foods.pdf", 96_000],
])
	await fs.writeFile(path.join(sandbox.workspace, "documents", name), Buffer.alloc(size, 32));

await fs.writeFile(
	path.join(sandbox.workspace, "inbox.json"),
	JSON.stringify([
		{
			id: "i0",
			question: "Do you hold a valid driving licence, and which class?",
			why: "Two of the roles involve visiting plants outside Arusha.",
			askedAt: iso(-1.2),
			answer: "Yes, class B. I have had it since 2018.",
			answeredAt: iso(-1.1),
			deliveredAt: iso(-1.1),
		},
		{
			id: "i00",
			question: "How much notice do you have to give your current employer?",
			askedAt: iso(-1.1),
			answer: "One month.",
			answeredAt: iso(-1.05),
			deliveredAt: iso(-1.05),
		},
		{
			id: "i1",
			question: "What is the lowest gross monthly salary you would accept, in TZS?",
			why: "Several forms require a figure.",
			askedAt: iso(-0.1),
		},
	]),
);
await fs.writeFile(path.join(sandbox.userData, "activity.json"), JSON.stringify(activity));

const { app, window } = await launchApp(sandbox);
const settle = () => window.waitForTimeout(500);

await window.evaluate(() =>
	window.desk.credentials.save({
		site: "careers.example.com",
		username: "rehema.kisanga@example.com",
		password: "demo-only",
	}),
);

const showAgent = (state) =>
	app.evaluate(({ BrowserWindow }, payload) => {
		for (const each of BrowserWindow.getAllWindows()) each.webContents.send("agent:state", payload);
	}, state);
const working = {
	status: "running",
	runLabel: "Looking for jobs",
	queued: 0,
	paused: false,
	active: {
		"kibo-bottlers-cost-accountant": "Writing the cover letter",
		"simba-telecom-finance-analyst": "Checking fit against the posting",
	},
};

const nav = (name) => window.getByRole("navigation").getByRole("button", { name });

for (const scheme of ["light", "dark"]) {
	await window.emulateMedia({ colorScheme: scheme });
	await nav(/^Jobs/).click();
	await window.locator("[data-card]").first().waitFor();
	await showAgent(working);
	await settle();
	await shot(window, `${scheme}-board`);
	if (scheme === "light") {
		await showAgent({ status: "idle", queued: 0, paused: false, active: {}, nextSweepAt: iso(0.12) });
		await settle();
		await shot(window, "light-board-idle");
		await showAgent(working);
	}

	if (scheme === "light") {
		await window.getByRole("button", { name: "Add a job" }).click();
		await settle();
		await shot(window, "light-add-job");
		await window.keyboard.press("Escape");
		await window.getByRole("button", { name: "Collapse the sidebar" }).click();
		await settle();
		await shot(window, "light-board-collapsed");
		await window.getByRole("button", { name: "Expand the sidebar" }).click();
		await settle();
	}

	await window.getByRole("button", { name: /Finance Associate/ }).click();
	await window.getByRole("dialog").waitFor();
	await window.waitForTimeout(900);
	await shot(window, `${scheme}-drawer-manual`);
	await window.keyboard.press("Escape");
	await window.waitForTimeout(700);

	await window.getByRole("button", { name: /Finance Officer/ }).click();
	await window.getByRole("dialog").waitFor();
	await window.waitForTimeout(900);
	await shot(window, `${scheme}-drawer-applied`);
	await window.keyboard.press("Escape");
	await window.waitForTimeout(700);

	await nav(/^Questions/).click();
	await settle();
	await shot(window, `${scheme}-questions`);

	await nav("Profile settings").click();
	await settle();
	await shot(window, `${scheme}-settings-documents`);
	if (scheme === "light") {
		await window.getByRole("heading", { name: "Site logins" }).scrollIntoViewIfNeeded();
		await window.mouse.wheel(0, 2000);
		await settle();
		await shot(window, "light-profile-logins");
	}

	await window.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
	await window.waitForTimeout(scheme === "light" ? 4000 : 1500);
	await shot(window, `${scheme}-settings`);
	if (scheme === "light") {
		await app.evaluate(
			({ BrowserWindow }, payload) => {
				for (const each of BrowserWindow.getAllWindows()) each.webContents.send("update:changed", payload);
			},
			{ current: "0.1.0", latest: "0.2.0", available: true, url: "https://example.com/", checkedAt: iso(0) },
		);
		await settle();
		await shot(window, "light-settings-update");
	}
}

await nav(/^Jobs/).click();
await window.emulateMedia({ colorScheme: "light" });
await window.setViewportSize({ width: 1040, height: 680 });
await settle();
await shot(window, "light-board-min");
console.log("gallery done");
await app.close();
