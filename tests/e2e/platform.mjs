import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

// A stand-in for the download site, so the update check never leaves this machine.
let latestVersion = "0.0.1";
// ...and for PostHog: what the app reports as usage is kept here and goes nowhere else.
const reported = [];
const updates = http.createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	if (request.url.startsWith("/batch")) {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			const { api_key, batch } = JSON.parse(body);
			for (const item of batch) reported.push({ ...item, api_key });
			response.end(JSON.stringify({ status: 1 }));
		});
		return;
	}
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
			page: `https://example.com/${latestVersion}`,
			downloads: Object.fromEntries(
				["mac", "win", "linux", "deb"].map((system) => [system, `https://example.com/${latestVersion}/${system}`]),
			),
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
	DPROZ_AGENT_POSTHOG_KEY: "phc_test",
	DPROZ_AGENT_POSTHOG_HOST: new URL(updateUrl).origin,
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
	const answerBox = window.locator("#agent-panel textarea:not([disabled])");
	await answerBox.waitFor({ timeout: 10_000 });
	check("the question is asked on the Questions screen, not on the board", true);
	await answerBox.fill("Yes, class B");
	await answerBox.press("ControlOrMeta+Enter");
	await window.waitForTimeout(1200);
	const answered = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8"));
	check("an answer given in the panel is saved to the card", answered.questions[0].answer === "Yes, class B");

	// Quick questions: a requirement, answered with one click and nothing more.
	const quick = (id, item, category) => ({ id, question: `Do you have this: ${item}?`, item, category, askedAt: now });
	await fs.writeFile(
		path.join(folder, "application.json"),
		JSON.stringify({
			...answered,
			questions: [
				...answered.questions,
				quick("q2", "Power BI", "skills"),
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
	await window
		.getByText("Nothing to answer right now")
		.or(window.locator("#agent-panel textarea[disabled]"))
		.first()
		.waitFor({ timeout: 10_000 });
	await window.waitForTimeout(600);
	const triaged = JSON.parse(await fs.readFile(path.join(folder, "application.json"), "utf8")).questions;
	const elsewhere = JSON.parse(await fs.readFile(path.join(second, "application.json"), "utf8")).questions[0];
	check(
		"a click is the whole answer: nothing asks the user to type more",
		triaged[1].answer === "I have it." &&
			triaged[2].answer === "I do not have it." &&
			(await answerBox.count()) === 0 &&
			(await window.getByRole("button", { name: /detail/i }).count()) === 0,
		`${triaged[1].answer} / ${triaged[2].answer}`,
	);
	await shot(window, `platform-${process.platform}-quick-answered`);
	check(
		"the same requirement on another job is answered without asking again",
		elsewhere.have === true && elsewhere.answer === "I have it.",
		elsewhere.answer,
	);
	await shot(window, `platform-${process.platform}-answered`);

	// A long thread: reading it, and typing an answer, are not disturbed by what arrives meanwhile.
	const inboxFile = path.join(sandbox.workspace, "inbox.json");
	const minute = (n) => new Date(Date.UTC(2026, 10, 15, 10, n)).toISOString();
	const ask = (id, n, question = `Question ${id}: what should the agent know?`) => ({
		id,
		question,
		askedAt: minute(n),
	});
	const longQuestion = `${"Which of the notice periods and start dates in your last three roles should the form give? ".repeat(5)}Say which.`;
	let inbox = [
		...Array.from({ length: 24 }, (_, n) => ({
			...ask(`old-${n}`, n),
			answer: `Saved answer ${n}`,
			answeredAt: minute(n),
		})),
		ask("t1", 30, longQuestion),
		ask("t2", 31),
	];
	const writeInbox = async () => {
		await fs.writeFile(inboxFile, JSON.stringify(inbox));
		await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("inbox:changed"));
		await window.waitForTimeout(300);
	};
	await writeInbox();
	const thread = window.locator("#agent-panel ol").locator("xpath=..");
	const replyingTo = window
		.locator("#agent-panel form")
		.getByText("Replying to")
		.locator("xpath=following-sibling::span[1]");
	await answerBox.waitFor({ timeout: 10_000 });
	check(
		"a long question shows on more than one line above the answer",
		(await replyingTo.evaluate((el) => el.getBoundingClientRect().height)) > 40,
	);
	await shot(window, `platform-${process.platform}-long-question`);
	// Where a message sits in the thread's window: the first one in view, or the one with this text.
	const messageInView = (text) =>
		thread.evaluate((el, text) => {
			const top = el.getBoundingClientRect().top;
			const items = [...el.querySelectorAll("li")];
			const item = text
				? items.find((li) => li.textContent === text)
				: items.find((li) => li.getBoundingClientRect().top > top + 40);
			return { text: item.textContent, offset: item.getBoundingClientRect().top - top };
		}, text);
	await thread.evaluate((el) => {
		el.scrollTop = el.scrollHeight * 0.5;
	});
	await window.waitForTimeout(200);
	const reading = await messageInView();
	await writeInbox();
	check(
		"a refresh does not move a thread being read",
		Math.abs((await messageInView(reading.text)).offset - reading.offset) < 2,
	);
	inbox[1].answer = "A much longer answer than before. ".repeat(30);
	inbox[2].deliveredAt = minute(40);
	inbox.push(ask("t3", 41));
	await writeInbox();
	const afterChanges = await messageInView(reading.text);
	check(
		"answers growing above and questions arriving below leave the reader on the same message",
		Math.abs(afterChanges.offset - reading.offset) < 2,
		`${reading.offset} -> ${afterChanges.offset}`,
	);
	const jump = window.getByRole("button", { name: "Jump to the latest" });
	check("away from the end, a button offers the latest", await jump.isVisible());
	await shot(window, `platform-${process.platform}-thread-reading`);
	await jump.click();
	await jump.waitFor({ state: "detached" });
	inbox.push(ask("t4", 42));
	await writeInbox();
	check(
		"at the end, the thread follows what arrives",
		await thread.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 2),
	);

	await answerBox.fill("Half an answer to the long question");
	inbox.push({ ...ask("k1", 43, "Do you have this: Tableau?"), item: "Tableau", category: "skills" });
	await writeInbox();
	check(
		"a quick question that arrives does not take over from the answer being typed",
		(await answerBox.inputValue()) === "Half an answer to the long question" &&
			(await answerBox.getAttribute("aria-label")) === longQuestion,
	);
	await window.getByRole("button", { name: "Previous question" }).click();
	await choice.getByText("Tableau", { exact: true }).waitFor();
	await window.getByRole("button", { name: "Next question" }).click();
	check(
		"a draft is still there after looking at another question",
		(await answerBox.inputValue()) === "Half an answer to the long question",
	);
	await window.getByRole("button", { name: "Next question" }).click();
	check("each question has its own draft", (await answerBox.inputValue()) === "");
	inbox = [];
	await writeInbox();

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
	await window.getByRole("textbox", { name: "Job links or posting" }).waitFor();
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

	// Site logins are a setting. Profile settings is the master resume and the user's documents.
	await window.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
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

	await nav("Profile settings").click();
	const origin = new URL(updateUrl).origin;
	const linkField = window.getByRole("textbox", { name: "Link to a page or file about you" });
	const addLink = window.getByRole("button", { name: "Add link" });
	// With documents already there, the place to add more stays out of the way until it is asked for.
	const addMore = window.getByRole("button", { name: "Add", exact: true });
	check("the place to add documents is closed while there are documents", !(await linkField.isVisible()));
	console.log(await shot(window, `platform-${process.platform}-documents-closed`));
	await addMore.click();
	await linkField.waitFor();
	const dropZone = window.getByRole("button", { name: /Drop a resume/ });
	await window.waitForTimeout(400);
	const aboveList = await window.evaluate(() => {
		const top = (element) => element.getBoundingClientRect().top;
		const bar = document.querySelector('aside[aria-label="Your documents"]');
		const zone = [...bar.querySelectorAll("button")].find((button) => button.textContent.includes("Drop a resume"));
		return top(zone) < top(bar.querySelector("ul")) && !bar.querySelector(".scroll-quiet").contains(zone);
	});
	check("Add opens it above the list, outside the part that scrolls", aboveList);
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

	// The file picker: it opens where the last file came from, and a failure is said out loud.
	const certificates = path.join(sandbox.base, "certificates");
	await fs.mkdir(certificates, { recursive: true });
	await fs.writeFile(path.join(certificates, "Certificate.txt"), "A certificate");
	await app.evaluate(({ dialog }) => {
		globalThis.pickerAsked = [];
		dialog.showOpenDialog = async (options) => {
			globalThis.pickerAsked.push(options.defaultPath);
			if (globalThis.pickerAnswer === "fail") throw new Error("The picker did not open");
			return globalThis.pickerAnswer ?? { canceled: true, filePaths: [] };
		};
	});
	const answer = (value) =>
		app.evaluate((_, value) => {
			globalThis.pickerAnswer = value;
		}, value);
	await answer({ canceled: false, filePaths: [path.join(certificates, "Certificate.txt")] });
	await dropZone.click();
	await window.getByRole("button", { name: "Preview Certificate.txt" }).waitFor();
	await answer(undefined);
	await dropZone.click();
	await waitFor(async () => (await app.evaluate(() => globalThis.pickerAsked.length)) === 2);
	const asked = await app.evaluate(() => globalThis.pickerAsked);
	check(
		"the file picker opens in the folder the last file came from",
		asked[1] === certificates,
		JSON.stringify(asked),
	);
	await answer("fail");
	await dropZone.click();
	check(
		"a file picker that fails says so",
		(await window.getByRole("alert").filter({ hasText: "Some documents could not be added" }).count()) === 1 ||
			(await window
				.getByRole("alert")
				.filter({ hasText: "Some documents could not be added" })
				.waitFor({ timeout: 5000 })
				.then(() => true)),
	);
	console.log(await shot(window, `platform-${process.platform}-documents-open`));
	await window.getByRole("button", { name: "Close", exact: true }).click();
	await linkField.waitFor({ state: "hidden" });
	check("and the same button closes it again", (await addMore.count()) === 1);

	// The user's own files open in the same preview panel as a card's documents.
	await window.getByRole("button", { name: "Preview Rehema Kisanga CV.pdf" }).click();
	const ownPreview = window.getByRole("complementary", { name: "Preview of Rehema Kisanga CV.pdf" });
	const ownSource = await ownPreview.locator("iframe").getAttribute("src", { timeout: 10_000 });
	const [ownStatus, ownStart] = await served(ownSource.split("#")[0]);
	check(
		"one of the user's documents opens as a preview beside the list",
		ownStatus === 200 && ownStart === "%PDF",
		ownSource,
	);
	console.log(await shot(window, `platform-${process.platform}-own-preview`));
	await ownPreview.getByRole("button", { name: "Download" }).click();
	await window.waitForTimeout(800);
	const ownCopy = await fs.readFile(path.join(saveTo, "Rehema Kisanga CV.pdf"), "utf8").catch(() => "");
	check("Download saves a copy of it", ownCopy === "%PDF-1.4 test");
	await ownPreview.getByRole("button", { name: "Close the preview" }).click();
	await ownPreview.waitFor({ state: "detached" });

	// The master resume is edited in place, and the agent is told what changed.
	const record = window.getByRole("region", { name: "Your master resume" });
	const page = record.getByRole("textbox", { name: "Your master resume" });
	await page.getByRole("heading", { name: "Other facts" }).waitFor({ timeout: 10_000 });
	const aboutMeFile = path.join(sandbox.workspace, "about-me.md");
	const onDisk = () => fs.readFile(aboutMeFile, "utf8");
	const toLineEnd = process.platform === "darwin" ? "Meta+ArrowRight" : "End";
	const saveButton = window.getByRole("button", { name: "Save", exact: true });
	const savedNote = window.getByRole("status").filter({ hasText: /^Saved/ });
	check(
		"the master resume is shown as a document, section by section",
		(await page.getByRole("heading").count()) >= 12,
	);
	console.log(await shot(window, `platform-${process.platform}-master-resume`));

	// An empty section says what belongs in it. Clicking that starts a line to type on.
	const hint = page.getByText("Things that matter to some jobs and not others");
	await hint.scrollIntoViewIfNeeded();
	await hint.click();
	await window.waitForTimeout(300);
	await window.getByRole("button", { name: "Bullet list" }).click();
	await window.keyboard.type("Class B driving licence, valid to 2029");
	await window.waitForTimeout(300);
	console.log(await shot(window, `platform-${process.platform}-master-resume-edit`));
	await saveButton.click();
	await savedNote.waitFor({ timeout: 10_000 });
	const afterEdit = await onDisk();
	check(
		"an edit is saved as Markdown, in the section it was made in, and the hints are not",
		/## Other facts\n\n[-*] Class B driving licence, valid to 2029\n\n## Do not have/.test(afterEdit) &&
			afterEdit.includes("## Experience") &&
			!afterEdit.includes("Things that matter"),
		afterEdit.slice(afterEdit.indexOf("## Other facts"), afterEdit.indexOf("## Standard answers")).trim(),
	);

	// The agent writes to the file while the user has an unsaved edit: neither is lost without a choice.
	await page.getByText("Class B driving licence, valid to 2029").click();
	await window.waitForTimeout(300);
	await window.keyboard.press(toLineEnd);
	await window.keyboard.type(", and class C");
	await window.waitForTimeout(300);
	await fs.writeFile(aboutMeFile, `${afterEdit}\n- Sage 300\n`);
	await saveButton.click();
	await record.getByText("The agent added to this while you were editing").waitFor({ timeout: 10_000 });
	check("a save does not overwrite what the agent wrote meanwhile", (await onDisk()).includes("- Sage 300"));
	await record.getByRole("button", { name: "Save mine over it" }).click();
	await savedNote.waitFor({ timeout: 10_000 });
	check("the user can choose their version", /valid to 2029, and class C/.test(await onDisk()));

	// The edits of one sitting are gathered into one run, which waits while the agent is paused.
	const waitForRun = async () => {
		for (let waited = 0; waited < 40_000; waited += 1000) {
			if ((await window.evaluate(() => window.desk.agent.state())).queued === 4) return true;
			await window.waitForTimeout(1000);
		}
		return false;
	};
	check("the agent is handed the edit in one run", await waitForRun());

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

	// A release that comes out after the last check: the button finds it when the pointer reaches it,
	// and pressing it fetches that release, not the one it was showing.
	// The button appeared under the pointer, which pressed "Check for updates" in the same place.
	await window.mouse.move(0, 0);
	await app.evaluate(({ shell }) => {
		globalThis.opened = [];
		shell.openExternal = async (url) => void globalThis.opened.push(url);
		// Two minutes on, so the answer the app has is no longer recent.
		globalThis.now = Date.now;
		Date.now = () => globalThis.now() + 120_000;
	});
	latestVersion = "9.9.10";
	await window.getByRole("button", { name: "Download 9.9.9" }).hover();
	await window.getByRole("button", { name: "Download 9.9.10" }).waitFor({ timeout: 10_000 });
	check("hovering the update button finds a release that came out since the last check", true);
	latestVersion = "9.9.11";
	await window.getByRole("button", { name: "Download 9.9.10" }).click();
	await window.getByRole("button", { name: "Download 9.9.11" }).waitFor({ timeout: 10_000 });
	const system = { darwin: "mac", win32: "win" }[process.platform] ?? "deb";
	const fetched = await app.evaluate(() => {
		Date.now = globalThis.now;
		return globalThis.opened;
	});
	check(
		"pressing it downloads the newest release, not the one it was showing",
		fetched.length === 1 && fetched[0] === `https://example.com/9.9.11/${system}`,
	);

	// Usage figures: what is reported, what is not, and the switch that stops it.
	const event = (name) => reported.find((item) => item.event === name);
	const arrives = async (name) => {
		for (let waited = 0; waited < 25 && !event(name); waited++) await window.waitForTimeout(1000);
		return event(name);
	};
	const opened = await arrives("app opened");
	check(
		"the app reports that it was opened, with its version, platform and model and no person profile",
		opened?.api_key === "phc_test" &&
			/^[0-9a-f-]{36}$/.test(opened.properties.distinct_id) &&
			opened.properties.platform === process.platform &&
			Boolean(opened.properties.app_version) &&
			opened.properties.$process_person_profile === false,
		JSON.stringify(opened?.properties),
	);
	check(
		"a quick answer is reported as a click, not as words",
		reported.some(
			(item) => item.event === "question answered" && item.properties.kind === "quick" && item.properties.have === true,
		) && reported.some((item) => item.event === "question answered" && item.properties.kind === "typed"),
	);
	await window.evaluate(() => window.desk.applications.setStatus("beta-analyst", "applied"));
	const applied = await arrives("application applied");
	check(
		"a card moved to Applied is reported, by whom and how it is sent, under a hash",
		applied?.properties.by === "user" &&
			applied.properties.from === "needs_input" &&
			applied.properties.apply_method === "url" &&
			/^[0-9a-f]{16}$/.test(applied.properties.application) &&
			event("application completed")?.properties.outcome === "applied",
		JSON.stringify(applied?.properties),
	);
	const everything = JSON.stringify(reported);
	const personal = ["Beta", "Finance Analyst", "Acme", "Accountant", "Rehema", "class B", "Power BI", sandbox.base];
	const leaked = personal.filter((text) => everything.includes(text));
	check("nothing reported names the user, a job, an employer or an answer", leaked.length === 0, leaked.join(", "));

	await window.getByRole("switch", { name: "Share anonymous usage figures" }).click();
	await window.waitForTimeout(500);
	const reportedSoFar = reported.length;
	await window.evaluate(() => window.desk.applications.setStatus("beta-analyst", "interview"));
	await window.waitForTimeout(18_000);
	check(
		"with sharing switched off nothing more is reported",
		reported.length === reportedSoFar && (await window.evaluate(() => window.desk.settings.get())).shareUsage === false,
		`${reported.length - reportedSoFar} more`,
	);
	await shot(window, `platform-${process.platform}-settings`);
} catch (error) {
	check("no harness error", false, error.stack);
	await shot(window, `platform-${process.platform}-failure`).catch(() => {});
} finally {
	await app.close().catch(() => {});
	updates.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
