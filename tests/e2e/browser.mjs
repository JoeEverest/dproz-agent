// A real run, inside the test fence: the user signs in to a site in the agent's browser, closes it, and
// the agent's next run finds itself signed in. Opens a Chromium window. Uses your Claude account.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

const requests = [];
// The only site the fenced agent may open: signing in sets a cookie, and the profile page needs it.
const site = http.createServer((request, response) => {
	requests.push(request.url);
	response.setHeader("content-type", "text/html; charset=utf-8");
	if (request.url.startsWith("/signin")) {
		response.setHeader("set-cookie", "session=rehema; Max-Age=86400; Path=/");
		response.end("<!doctype html><title>Signed in</title><h1>You are signed in.</h1>");
		return;
	}
	if (request.url.startsWith("/profile")) {
		const signedIn = (request.headers.cookie ?? "").includes("session=rehema");
		response.end(
			signedIn
				? "<!doctype html><title>Member profile</title><h1>Rehema Kisanga</h1><p>Certified Fraud Examiner since 2024, membership number 88213.</p>"
				: "<!doctype html><title>Sign in</title><h1>Sign in</h1><p>You need to sign in to see this profile.</p>",
		);
		return;
	}
	response.statusCode = 404;
	response.end("Not found");
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${site.address().port}`;

const sandbox = await createSandbox("browser", { settings: { onboarded: true, paused: false } });
// A search is not due, so the only run is the one the link starts.
await fs.writeFile(
	path.join(sandbox.userData, "agent.json"),
	JSON.stringify({ lastSweepAt: new Date().toISOString() }),
);
// Not headless: the agent's browser is never headless for a user, and headless Chromium keeps its own cookies.
const { app, window } = await launchApp(sandbox, {
	DPROZ_AGENT_TEST_ORIGIN: origin,
	DPROZ_API_URL: `${origin}/api`,
	DPROZ_SITE_URL: origin,
});

const results = [];
const check = (name, passed, detail = "") => {
	results.push(Boolean(passed));
	console.log(passed ? "PASS" : "FAIL", name, detail);
};
const agentState = () => window.evaluate(() => window.desk.agent.state());
const until = async (test, timeout) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await test()) return true;
		await window.waitForTimeout(500);
	}
	return false;
};

try {
	await window.getByRole("heading", { name: "Jobs", exact: true }).waitFor({ timeout: 30_000 });
	const opened = await window.evaluate((url) => window.desk.browser.open(url), `${origin}/signin`);
	check("the agent's browser opens for the user", opened.ok, JSON.stringify(opened));
	check(
		"and loads the page they sign in on",
		await until(() => requests.some((url) => url.startsWith("/signin")), 30_000),
	);
	check("the agent knows its browser is taken", (await agentState()).browserOpen);
	await window.getByText("Close its browser to carry on").waitFor({ timeout: 5000 });
	console.log(await shot(window, "browser-open-jobs"));

	await window.evaluate((link) => window.desk.documents.addLink(link), `${origin}/profile`);
	await window.evaluate((link) => window.desk.agent.linksAdded([link]), `${origin}/profile`);
	await window.waitForTimeout(3000);
	const held = await agentState();
	check("work waits while the user has the browser", held.status === "idle" && held.queued === 1, JSON.stringify(held));

	await window.getByRole("button", { name: "Profile settings" }).click();
	await window.getByText("The agent's browser", { exact: true }).scrollIntoViewIfNeeded();
	console.log(await shot(window, "browser-open-profile"));
	await window.getByRole("button", { name: "Close browser" }).click();
	check("closing it releases the agent", await until(async () => !(await agentState()).browserOpen, 20_000));
	check(
		"and the waiting work starts by itself",
		await until(async () => (await agentState()).status === "running", 10_000),
	);

	await until(async () => (await agentState()).status === "idle", 10 * 60_000);
	const activity = await window.evaluate(() => window.desk.agent.activity());
	const errors = activity.filter((item) => item.kind === "notice" && item.tone === "error").map((item) => item.text);
	check("the run finished without errors", errors.length === 0, errors.join("; "));
	const aboutMe = await fs.readFile(path.join(sandbox.workspace, "about-me.md"), "utf8");
	check(
		"the agent's browser was signed in: it read the page behind the sign-in",
		aboutMe.includes("88213"),
		aboutMe.split("\n").find((line) => line.includes("Fraud")) ?? "the signed-in page was not read",
	);
} catch (error) {
	check("no harness error", false, error.stack);
} finally {
	await window.evaluate(() => window.desk.agent.setPaused(true)).catch(() => {});
	await window.evaluate(() => window.desk.browser.close()).catch(() => {});
	await app.close().catch(() => {});
	site.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
