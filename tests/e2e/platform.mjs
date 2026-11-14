import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

// A stand-in for the download site, so the update check never leaves this machine.
let latestVersion = "0.0.1";
const updates = http.createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	// Also stands in for the Anthropic API when a key is checked: it refuses exactly one key.
	// ...and for another endpoint: it refuses one token and does not know one model.
	if (request.url.startsWith("/v1/messages")) {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			const refused =
				request.headers.authorization === "Bearer refused-token" || request.headers["x-api-key"] === "refused-token";
			const unknown = JSON.parse(body).model === "no-such-model";
			response.statusCode = refused ? 401 : unknown ? 404 : 200;
			response.end(
				JSON.stringify(
					unknown ? { error: { message: "model 'no-such-model' not found" } } : { id: "msg_test", content: [] },
				),
			);
		});
		return;
	}
	if (request.url.startsWith("/v1/models")) {
		const refused = request.headers["x-api-key"] === "sk-ant-refused";
		response.statusCode = refused ? 401 : 200;
		response.end(
			JSON.stringify(refused ? { type: "error" } : { data: [{ id: "open-model:14b" }, { id: "other-model" }] }),
		);
		return;
	}
	// ...and for the web, when a link is added as a source: one address is a file, one is a page.
	if (request.url.startsWith("/files/cv")) {
		response.setHeader("content-type", "application/pdf");
		response.setHeader("content-disposition", 'attachment; filename="Rehema Kisanga CV.pdf"');
		response.end("%PDF-1.4 test");
		return;
	}
	if (request.url.startsWith("/portfolio")) {
		response.setHeader("content-type", "text/html; charset=utf-8");
		response.end("<!doctype html><title>Portfolio</title><h1>Rehema Kisanga</h1>");
		return;
	}
	// Not an Ollama server, so the app never goes on to ask ollama.com for cloud models.
	if (request.url.startsWith("/api/version")) {
		response.statusCode = 404;
		response.end("{}");
		return;
	}
	response.end(
		JSON.stringify({
			version: latestVersion,
			page: "https://example.com/",
			downloads: { mac: "https://example.com/mac", linux: "https://example.com/linux" },
		}),
	);
});
await new Promise((resolve) => updates.listen(0, "127.0.0.1", resolve));
const updateUrl = `http://127.0.0.1:${updates.address().port}/api/latest`;

const sandbox = await createSandbox("platform");
const saveTo = path.join(sandbox.base, "saved");
await fs.mkdir(saveTo, { recursive: true });
const { app, window } = await launchApp(sandbox, {
	DPROZ_AGENT_UPDATE_URL: updateUrl,
	DPROZ_AGENT_ANTHROPIC_URL: new URL(updateUrl).origin,
	DPROZ_AGENT_SAVE_TO: saveTo,
});
const results = [];
const check = (name, passed, detail = "") => {
	results.push(Boolean(passed));
	console.log(passed ? "PASS" : "FAIL", name, detail);
};
const status = () => window.evaluate(() => window.desk.setup.status());

try {
	await window.getByRole("heading", { name: "Set up your job-search agent" }).waitFor({ timeout: 30_000 });
	check("the app boots to setup", true, process.platform);

	const before = await status();
	check(
		"the Claude check answers without crashing",
		typeof before.claude.signedIn === "boolean",
		JSON.stringify(before.claude).slice(0, 120),
	);
	console.log("credential storage:", JSON.stringify(before.credentialStorage));

	if (!before.browserInstalled) {
		await window.getByRole("button", { name: "Download browser" }).click();
		for (let waited = 0; waited < 600 && !(await status()).browserInstalled; waited += 3)
			await window.waitForTimeout(3000);
	}
	check("the agent's browser installs and is detected", (await status()).browserInstalled);

	const start = window.getByRole("button", { name: "Start", exact: true });
	check("Start waits for documents", await start.isDisabled());
	const note = path.join(sandbox.base, "My CV.txt");
	await fs.writeFile(note, "Test CV");
	const documents = await window.evaluate((file) => window.desk.documents.add([file, file]), note);
	check(
		"documents are copied in, with a second copy renamed",
		documents.map((document) => document.name).join("|") === "My CV 2.txt|My CV.txt",
	);
	await window.waitForTimeout(2500);
	if (process.env.EXPECT_SIGNED_OUT) {
		check("a machine with no Claude sign-in is reported as signed out", before.claude.signedIn === false);
		check("setup cannot be finished without a sign-in", await start.isDisabled());
	} else check("Start is available once documents and sign-in are in place", await start.isEnabled());

	await window.evaluate(() => window.desk.settings.update({ onboarded: true }));
	await window.reload();
	await window.getByRole("heading", { name: "No jobs yet" }).waitFor();
	const state = await window.evaluate(() => window.desk.agent.state());
	check("a paused agent starts nothing", state.paused && state.status === "idle");

	const folder = path.join(sandbox.workspace, "applications", "acme-accountant");
	await fs.mkdir(folder, { recursive: true });
	const now = new Date().toISOString();
	await fs.writeFile(path.join(folder, "Resume.pdf"), "%PDF-1.4");
	await fs.writeFile(
		path.join(folder, "application.json"),
		JSON.stringify({
			id: "acme-accountant",
			title: "Accountant",
			company: "Acme",
			status: "found",
			source: "web",
			applyMethod: "url",
			documents: [{ label: "Resume", file: "Resume.pdf" }],
			questions: [{ id: "q1", question: "Do you hold a driving licence?", askedAt: now }],
			timeline: [{ at: now, event: "Found" }],
			createdAt: now,
			updatedAt: now,
		}),
	);
	await window.getByRole("button", { name: /Accountant/ }).waitFor({ timeout: 10_000 });
	check("a card written to disk appears on the board without a reload", true);
	await shot(window, `platform-${process.platform}-board`);

	const nav = (name) => window.getByRole("navigation").getByRole("button", { name });
	await nav("Questions (1)").waitFor({ timeout: 10_000 });
	check("a question from the agent shows as a count on Questions", true);
	await nav("Questions (1)").click();
	const answerBox = window.locator("#agent-panel textarea[placeholder='Your answer']");
	await answerBox.waitFor({ timeout: 10_000 });
	check("the question is asked on the Questions screen, not on the board", true);
	await answerBox.fill("Yes, class B");
	await answerBox.press("ControlOrMeta+Enter");
	await window.waitForTimeout(1200);
	const answered = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8"));
	check("an answer given in the panel is saved to the card", answered.questions[0].answer === "Yes, class B");

	// Quick questions: a requirement, answered with one click, then the follow-up for what they have.
	const quick = (id, item, category, followUp) => ({
		id,
		question: `Do you have this: ${item}?`,
		item,
		category,
		followUp,
		askedAt: now,
	});
	await fs.writeFile(
		path.join(folder, "application.json"),
		JSON.stringify({
			...answered,
			questions: [
				...answered.questions,
				quick("q2", "Power BI", "skills", "Where did you use Power BI, and what did the reports change?"),
				quick("q3", "CPA(T) or an equivalent qualification", "certifications"),
			],
		}),
	);
	const second = path.join(sandbox.workspace, "applications", "beta-analyst");
	await fs.mkdir(second, { recursive: true });
	await fs.writeFile(
		path.join(second, "application.json"),
		JSON.stringify({
			id: "beta-analyst",
			title: "Finance Analyst",
			company: "Beta",
			status: "needs_input",
			source: "web",
			applyMethod: "url",
			questions: [quick("q4", "power-bi", "skills")],
			timeline: [{ at: now, event: "Found" }],
			createdAt: now,
			updatedAt: now,
		}),
	);
	await window.getByText("3 waiting for you").waitFor({ timeout: 10_000 });
	const choice = window.locator("#agent-panel form fieldset");
	await choice.getByText("Power BI", { exact: true }).waitFor({ timeout: 10_000 });
	check(
		"a quick question is asked with two answers, before anything that needs typing",
		(await answerBox.count()) === 0,
	);
	await shot(window, `platform-${process.platform}-quick-question`);
	await choice.getByRole("button", { name: /^I have it/ }).click();
	await choice.getByText("CPA(T) or an equivalent qualification").waitFor({ timeout: 10_000 });
	check("one click answers it and moves to the next quick question", true);
	await choice.getByRole("button", { name: /^Not yet/ }).click();
	await answerBox.waitFor({ timeout: 10_000 });
	check(
		"what the user has is followed up with a deeper question",
		(await answerBox.getAttribute("aria-label")) === "Where did you use Power BI, and what did the reports change?",
	);
	await shot(window, `platform-${process.platform}-follow-up`);
	await answerBox.fill("At Acme, for the monthly sales reports. Reporting went from 3 days to 1.");
	await answerBox.press("ControlOrMeta+Enter");
	await window.waitForTimeout(1200);
	const triaged = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8")).questions;
	const elsewhere = JSON.parse(await fs.readFile(path.join(second, "application.json"), "utf8")).questions[0];
	check(
		"the answers are saved to the card",
		triaged[1].have === true && triaged[1].answer.startsWith("I have it. At Acme") && triaged[2].have === false,
		`${triaged[1].answer} / ${triaged[2].answer}`,
	);
	check(
		"the same requirement on another job is answered without asking again",
		elsewhere.have === true && elsewhere.answer === "I have it.",
		elsewhere.answer,
	);
	const facts = JSON.parse(await fs.readFile(path.join(sandbox.workspace, "facts.json"), "utf8"));
	check(
		"every answer is kept as a fact",
		facts.some((fact) => fact.item === "Power BI" && fact.have && /3 days to 1/.test(fact.answer)) &&
			facts.some((fact) => /CPA/.test(fact.item ?? "") && fact.have === false) &&
			facts.some((fact) => fact.answer === "Yes, class B"),
		`${facts.length} facts`,
	);
	await shot(window, `platform-${process.platform}-answered`);
	const withOneMore = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8"));
	withOneMore.questions.push(quick("q5", "SAP", "skills"));
	await fs.writeFile(path.join(folder, "application.json"), JSON.stringify(withOneMore));

	await nav("Jobs").click();
	await window.getByRole("button", { name: /Accountant/ }).click();
	const drawer = window.getByRole("dialog");
	await drawer.waitFor();
	const onCard = drawer.locator("fieldset");
	await onCard.getByText("SAP", { exact: true }).waitFor({ timeout: 10_000 });
	await onCard.scrollIntoViewIfNeeded();
	await shot(window, `platform-${process.platform}-card-question`);
	await onCard.getByRole("button", { name: /^Not yet/ }).click();
	await window.waitForTimeout(1000);
	const fromCard = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8")).questions.at(-1);
	check("a quick question can be answered on the card too", fromCard.have === false, fromCard.answer);
	const resumeRow = drawer.getByRole("button", { name: /^Preview Resume/ });
	check("the card shows its documents", (await resumeRow.count()) === 1);
	await resumeRow.click();
	const preview = window.getByRole("complementary", { name: "Preview of Resume" });
	const source = await preview.locator("iframe").getAttribute("src", { timeout: 10_000 });
	const served = (url) =>
		app.evaluate(async ({ net }, target) => {
			const response = await net.fetch(target).catch(() => null);
			return response ? [response.status, (await response.text()).slice(0, 4)] : [0, ""];
		}, url);
	const [previewStatus, previewStart] = await served(source.split("#")[0]);
	check("a document opens as a preview beside the card", previewStatus === 200 && previewStart === "%PDF", source);
	check(
		"the card stays open next to the preview",
		(await drawer.getByRole("heading", { name: "Accountant" }).count()) === 1,
	);
	const [escaped] = await served("desk-doc://application/acme-accountant/..%2F..%2Fabout-me.md");
	check("the preview cannot reach files outside the card's folder", escaped === 404, String(escaped));
	await preview.getByRole("button", { name: "Download" }).click();
	await window.waitForTimeout(800);
	const copy = await fs.readFile(path.join(saveTo, "Resume.pdf"), "utf8").catch(() => "");
	check("Download saves a copy of the document", copy.startsWith("%PDF"));
	await preview.getByRole("button", { name: "Close the preview" }).click();
	await preview.waitFor({ state: "detached" });
	await window
		.getByRole("combobox", { name: "Status" })
		.or(window.getByRole("button", { name: "Status" }))
		.first()
		.click();
	await window.getByRole("option", { name: "Interview" }).click();
	for (
		let tries = 0;
		tries < 20 && (await window.evaluate(() => window.desk.applications.list()))[0]?.status !== "interview";
		tries++
	) {
		await window.waitForTimeout(500);
	}
	const saved = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8"));
	check(
		"changing the status in the drawer is written to the card's file",
		saved.status === "interview" && saved.timeline.at(-1).event === "Moved to Interview",
	);
	await window.keyboard.press("Escape");
	await window.waitForTimeout(800);
	check("Escape closes the drawer", (await window.getByRole("dialog").count()) === 0);

	await window.getByRole("button", { name: "Add a job" }).click();
	await window.getByRole("textbox", { name: "Job link or posting" }).waitFor();
	check(
		"Add a job opens, with both actions disabled until something is pasted",
		await window.getByRole("button", { name: "Apply for me" }).isDisabled(),
	);
	await window.keyboard.press("Escape");

	await window.evaluate(() =>
		window.desk.credentials.save({ site: "careers.example.com", username: "me@example.com", password: "s3cret-value" }),
	);
	const vault = await fs.readFile(path.join(sandbox.userData, "credentials.vault"));
	const storage = (await status()).credentialStorage;
	check(
		"the password is never written to disk in clear text",
		!vault.includes("s3cret-value"),
		JSON.stringify(storage),
	);

	await nav("Profile settings").click();
	await window.getByText("careers.example.com", { exact: true }).scrollIntoViewIfNeeded();
	await window.waitForTimeout(4000);
	check("the saved login is listed in settings", true);
	check(
		"the keyring warning shows exactly when storage is not encrypted",
		(await window.getByText("no system keyring").count()) > 0 === !storage.encrypted,
	);

	const browserOpen = async () => (await window.evaluate(() => window.desk.agent.state())).browserOpen;
	const waitFor = async (test) => {
		for (let waited = 0; waited < 30_000 && !(await test()); waited += 500) await window.waitForTimeout(500);
		return test();
	};
	await window.getByRole("button", { name: "Open browser" }).click();
	check("the agent's browser opens for the user to sign in", await waitFor(browserOpen));
	await window.waitForTimeout(3000);
	await window.getByRole("button", { name: "Close browser" }).click();
	check("and closing it hands the browser back to the agent", await waitFor(async () => !(await browserOpen())));

	const origin = new URL(updateUrl).origin;
	const linkField = window.getByRole("textbox", { name: "Link to a page or file about you" });
	const addLink = window.getByRole("button", { name: "Add link" });
	const savedLinks = async () =>
		JSON.parse(await fs.readFile(path.join(sandbox.workspace, "links.json"), "utf8").catch(() => "[]"));
	await linkField.fill("my resume");
	await addLink.click();
	check(
		"something that is not a link is refused",
		(await window.getByText("That does not look like a web link.").count()) === 1 && (await savedLinks()).length === 0,
	);
	await linkField.fill(`${origin}/portfolio#work`);
	await addLink.click();
	await window.getByRole("button", { name: /Remove the link to 127\.0\.0\.1/ }).waitFor({ timeout: 30_000 });
	check(
		"a link to a page is kept as a link for the agent to read",
		(await savedLinks()).map((link) => link.url).join() === `${origin}/portfolio`,
		JSON.stringify(await savedLinks()),
	);
	await linkField.fill(`${origin}/files/cv`);
	await addLink.click();
	await window.getByText("Rehema Kisanga CV.pdf", { exact: true }).waitFor({ timeout: 30_000 });
	const downloaded = await fs.readFile(path.join(sandbox.workspace, "documents", "Rehema Kisanga CV.pdf"), "utf8");
	check(
		"a link to a file is downloaded as a document",
		downloaded === "%PDF-1.4 test" && (await savedLinks()).length === 1,
	);
	const queued = await window.evaluate(() => window.desk.agent.state());
	check("both are handed to the agent, which stays paused", queued.queued === 2 && queued.status === "idle");
	console.log(await shot(window, `platform-${process.platform}-links`));
	await window.getByRole("button", { name: /Remove the link to 127\.0\.0\.1/ }).click();
	await window.getByRole("button", { name: /Remove the link to/ }).waitFor({ state: "detached" });
	check("a link can be removed", (await savedLinks()).length === 0);

	// Answers can be corrected, and the agent is told what changed.
	const answers = window.getByRole("region", { name: "Your answers" });
	await answers.scrollIntoViewIfNeeded();
	await answers.getByText("Power BI", { exact: true }).waitFor({ timeout: 10_000 });
	const savedFacts = async () => JSON.parse(await fs.readFile(path.join(sandbox.workspace, "facts.json"), "utf8"));
	check(
		"every answer is listed in Profile settings",
		(await answers.getByRole("listitem").count()) === (await savedFacts()).length,
		`${await answers.getByRole("listitem").count()} answers`,
	);
	console.log(await shot(window, `platform-${process.platform}-answers`));
	await answers.getByRole("button", { name: "Correct your answer about Power BI" }).click();
	await answers.getByRole("combobox", { name: "Do you have this: Power BI" }).click();
	await window.getByRole("option", { name: "I do not have it" }).click();
	console.log(await shot(window, `platform-${process.platform}-answer-edit`));
	await answers.getByRole("button", { name: "Save" }).click();
	await answers.getByText("Saved. The agent will act on it").waitFor({ timeout: 10_000 });
	const corrected = (await savedFacts()).find((fact) => fact.item === "Power BI");
	check(
		"a corrected answer replaces the old one",
		corrected.have === false && corrected.answer === "I do not have it." && Boolean(corrected.correctedAt),
		corrected.answer,
	);
	await answers.getByRole("button", { name: "Correct your answer about Do you hold a driving licence?" }).click();
	await answers.getByRole("textbox", { name: "Do you hold a driving licence?" }).fill("Yes, class B and C");
	await answers.getByRole("button", { name: "Save" }).click();
	await answers.getByText("Yes, class B and C").waitFor({ timeout: 10_000 });
	const factCount = (await savedFacts()).length;
	await answers.getByRole("button", { name: "Remove your answer about SAP" }).click();
	await answers.getByText("SAP", { exact: true }).waitFor({ state: "detached" });
	check(
		"an answer can be reworded or removed",
		(await savedFacts()).length === factCount - 1 &&
			(await savedFacts()).some((fact) => fact.answer === "Yes, class B and C"),
	);
	// The corrections of one sitting are gathered into one run, which waits while the agent is paused.
	const waitForRun = async () => {
		for (let waited = 0; waited < 40_000; waited += 1000) {
			if ((await window.evaluate(() => window.desk.agent.state())).queued === 3) return true;
			await window.waitForTimeout(1000);
		}
		return false;
	};
	check("the agent is handed the corrections in one run", await waitForRun());

	await window.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
	await window.getByRole("heading", { name: "Settings", exact: true }).waitFor();
	check(
		"the agent settings live on the Settings page",
		(await window.getByText("Send applications automatically", { exact: true }).count()) === 1,
	);

	const openForm = async () => {
		const other = window.getByRole("button", { name: "Use something else" });
		if (await other.count()) await other.click();
	};
	await openForm();
	const keyBox = window.getByRole("textbox", { name: "Anthropic API key" });
	await keyBox.fill("sk-ant-refused");
	await window.getByRole("button", { name: "Use this key" }).click();
	await window.getByText("Anthropic did not accept that key").waitFor({ timeout: 20_000 });
	check("a key Anthropic refuses is not saved", (await status()).connection.kind === "claude-code");
	await keyBox.fill("sk-ant-test-key-1234");
	await window.getByRole("button", { name: "Use this key" }).click();
	await window.getByText("API key ending in 1234").waitFor({ timeout: 30_000 });
	const withKey = await status();
	check(
		"an accepted key becomes the way the agent signs in",
		withKey.connection.kind === "api-key" && withKey.claude.signedIn && withKey.claude.method === "api-key",
		JSON.stringify(withKey.claude).slice(0, 120),
	);
	const sealed = () => fs.readFile(path.join(sandbox.userData, "connection.sealed"));
	check("the key is never written to disk in clear text", !(await sealed()).includes("sk-ant-test-key-1234"));
	await window.getByRole("button", { name: "Remove", exact: true }).click();
	await window.getByText("API key ending in 1234").waitFor({ state: "detached", timeout: 30_000 });
	check("removing the key goes back to the Claude Code sign-in", (await status()).connection.kind === "claude-code");

	const endpointUrl = new URL(updateUrl).origin;
	await openForm();
	await window.getByRole("button", { name: "Another endpoint" }).click();
	await window.getByRole("textbox", { name: "Address" }).fill(`${endpointUrl}/v1/messages`);
	const modelPicker = window.locator("form").getByRole("combobox", { name: "Model" });
	await modelPicker.waitFor({ timeout: 15_000 });
	await modelPicker.click();
	check(
		"the models the endpoint offers are listed to pick from",
		(await window.getByRole("option", { name: "other-model" }).count()) === 1,
	);
	await window.getByRole("option", { name: "Type a name…" }).click();
	await window.getByRole("textbox", { name: "Model" }).fill("no-such-model");
	await window.getByRole("button", { name: "Use this endpoint" }).click();
	await window.getByText("model 'no-such-model' not found").waitFor({ timeout: 20_000 });
	check("an endpoint without the named model is not saved", (await status()).connection.kind === "claude-code");
	await window.getByRole("button", { name: "Pick from the list" }).click();
	await modelPicker.click();
	await window.getByRole("option", { name: "open-model:14b" }).click();
	await window.getByRole("textbox", { name: "Token" }).fill("refused-token");
	await window.getByRole("button", { name: "Use this endpoint" }).click();
	await window.getByText("did not accept the token").waitFor({ timeout: 20_000 });
	check("an endpoint that refuses the token is not saved", (await status()).connection.kind === "claude-code");
	await window.getByRole("textbox", { name: "Token" }).fill("secret-endpoint-token");
	await window.getByRole("button", { name: "Use this endpoint" }).click();
	await window.getByText(`open-model:14b at ${endpointUrl}`).waitFor({ timeout: 30_000 });
	const withEndpoint = await status();
	check(
		"a working endpoint is saved with its address tidied and its model",
		withEndpoint.connection.kind === "custom" &&
			withEndpoint.connection.baseUrl === endpointUrl &&
			withEndpoint.connection.model === "open-model:14b" &&
			withEndpoint.claude.signedIn,
		JSON.stringify(withEndpoint.connection),
	);
	check(
		"the endpoint's token is never written to disk in clear text",
		!(await sealed()).includes("secret-endpoint-token"),
	);
	await shot(window, `platform-${process.platform}-endpoint`);
	await window.getByRole("combobox", { name: "Model" }).click();
	await window.getByRole("option", { name: "other-model" }).click();
	await window.getByText(`other-model at ${endpointUrl}`).waitFor({ timeout: 30_000 });
	check("the model can be switched from Settings", (await status()).connection.model === "other-model");
	await window.getByRole("button", { name: "Remove", exact: true }).click();
	await window.getByText(`other-model at ${endpointUrl}`).waitFor({ state: "detached", timeout: 30_000 });
	check("removing the endpoint clears it", (await status()).connection.kind === "claude-code");

	const updateIcon = window.getByRole("navigation").getByRole("button", { name: /is available/ });
	check("no update icon while the installed version is current", (await updateIcon.count()) === 0);
	latestVersion = "9.9.9";
	await window.getByRole("button", { name: "Check for updates" }).click();
	await updateIcon.waitFor({ timeout: 10_000 });
	check("an update icon appears when a newer release is out", (await updateIcon.count()) === 1);
	check(
		"the Settings page offers the new version",
		(await window.getByRole("button", { name: "Download 9.9.9" }).count()) === 1,
	);
	console.log(await shot(window, `platform-${process.platform}`));
} catch (error) {
	check("no harness error", false, error.stack);
	await shot(window, `platform-${process.platform}-failure`).catch(() => {});
} finally {
	await app.close().catch(() => {});
	updates.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
