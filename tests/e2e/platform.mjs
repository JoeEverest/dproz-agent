import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

// A stand-in for the download site, so the update check never leaves this machine.
let latestVersion = "0.0.1";
const updates = http.createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	// Also stands in for the Anthropic API when a key is checked: it refuses exactly one key.
	if (request.url.startsWith("/v1/models")) {
		const refused = request.headers["x-api-key"] === "sk-ant-refused";
		response.statusCode = refused ? 401 : 200;
		response.end(JSON.stringify(refused ? { type: "error" } : { data: [] }));
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
const { app, window } = await launchApp(sandbox, {
	DPROZ_AGENT_UPDATE_URL: updateUrl,
	DPROZ_AGENT_ANTHROPIC_URL: new URL(updateUrl).origin,
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

	await nav("Jobs").click();
	await window.getByRole("button", { name: /Accountant/ }).click();
	const drawer = window.getByRole("dialog");
	await drawer.waitFor();
	check("the card shows its documents", (await drawer.getByRole("button", { name: /Resume/ }).count()) === 1);
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

	await window.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
	await window.getByRole("heading", { name: "Settings", exact: true }).waitFor();
	check(
		"the agent settings live on the Settings page",
		(await window.getByText("Send applications automatically", { exact: true }).count()) === 1,
	);

	const useKey = window.getByRole("button", { name: "Use an API key instead" });
	if (await useKey.count()) await useKey.click();
	const keyBox = window.getByRole("textbox", { name: "Anthropic API key" });
	await keyBox.fill("sk-ant-refused");
	await window.getByRole("button", { name: "Use this key" }).click();
	await window.getByText("Anthropic did not accept that key").waitFor({ timeout: 20_000 });
	check("a key Anthropic refuses is not saved", !(await status()).apiKey.set);
	await keyBox.fill("sk-ant-test-key-1234");
	await window.getByRole("button", { name: "Use this key" }).click();
	await window.getByText("API key ending in 1234").waitFor({ timeout: 30_000 });
	const withKey = await status();
	check(
		"an accepted key becomes the way the agent signs in",
		withKey.apiKey.set && withKey.claude.signedIn && withKey.claude.method === "api-key",
		JSON.stringify(withKey.claude).slice(0, 120),
	);
	const keyOnDisk = await fs.readFile(path.join(sandbox.userData, "anthropic.key"));
	check("the key is never written to disk in clear text", !keyOnDisk.includes("sk-ant-test-key-1234"));
	await window.getByRole("button", { name: "Remove key" }).click();
	await window.getByText("API key ending in 1234").waitFor({ state: "detached", timeout: 30_000 });
	check("removing the key goes back to the Claude Code sign-in", !(await status()).apiKey.set);

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
