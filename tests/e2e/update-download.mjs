import assert from "node:assert/strict";
import http from "node:http";
import { createSandbox, launchApp, shot } from "./harness.mjs";

let version = "9.0.0";
let status = 200;
let missing = false;
let requests = 0;
let hold = false;
let arrived;
let release;
const site = http.createServer(async (_request, response) => {
	requests++;
	const body = {
		version,
		page: "https://example.com/releases",
		downloads: missing
			? {}
			: Object.fromEntries(["deb", "linux", "mac", "win"].map((key) => [key, `https://example.com/${version}/${key}`])),
	};
	if (hold) {
		await new Promise((resolve) => {
			release = resolve;
			arrived();
		});
	}
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const sandbox = await createSandbox("update-download", { settings: { onboarded: true } });
let app;
try {
	const running = await launchApp(sandbox, {
		DPROZ_AGENT_UPDATE_URL: `http://127.0.0.1:${site.address().port}/latest`,
	});
	app = running.app;
	const window = running.window;
	await app.evaluate(({ shell }) => {
		globalThis.openedUpdateUrls = [];
		shell.openExternal = async (url) => {
			globalThis.openedUpdateUrls.push(url);
		};
	});
	await window.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
	await window.getByRole("button", { name: "Download 9.0.0", exact: true }).waitFor();
	const before = requests;
	version = "9.1.0";
	hold = true;
	const requestArrived = new Promise((resolve) => {
		arrived = resolve;
	});
	await window.getByRole("button", { name: "Download 9.0.0", exact: true }).click();
	await requestArrived;
	await window.getByRole("button", { name: "Checking latest release", exact: true }).waitFor();
	assert.equal(await window.getByRole("button", { name: "Checking latest release", exact: true }).isDisabled(), true);
	assert.equal(
		await window
			.getByRole("navigation")
			.getByRole("button", { name: "Checking the latest release", exact: true })
			.isDisabled(),
		true,
	);
	await window.evaluate(() => Promise.all([window.desk.updates.openDownload(), window.desk.updates.openDownload()]));
	assert.equal(requests, before + 1);
	hold = false;
	release();
	await window.getByRole("button", { name: "Download 9.1.0", exact: true }).waitFor();
	const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "deb";
	assert.deepEqual(await app.evaluate(() => globalThis.openedUpdateUrls), [`https://example.com/9.1.0/${platform}`]);
	status = 503;
	await window
		.getByRole("navigation")
		.getByRole("button", { name: /Version 9.1.0 is available/ })
		.click();
	await window.getByRole("alertdialog").waitFor();
	assert.match((await window.getByRole("alertdialog").textContent()) ?? "", /503/);
	await shot(window, "update-download-error");
	await window.getByRole("button", { name: "Close", exact: true }).click();
	status = 200;
	missing = true;
	version = "9.2.0";
	await window.getByRole("button", { name: "Download 9.1.0", exact: true }).click();
	await window.getByRole("alertdialog").waitFor();
	assert.match((await window.getByRole("alertdialog").textContent()) ?? "", /no installer for this platform/);
	assert.equal((await app.evaluate(() => globalThis.openedUpdateUrls)).length, 1);
	await window.getByRole("button", { name: "Close", exact: true }).click();
	missing = false;
	version = "9.3.0";
	await window.getByRole("button", { name: "Download 9.2.0", exact: true }).click();
	await window.getByRole("button", { name: "Download 9.3.0", exact: true }).waitFor();
	assert.deepEqual(await app.evaluate(() => globalThis.openedUpdateUrls), [
		`https://example.com/9.1.0/${platform}`,
		`https://example.com/9.3.0/${platform}`,
	]);
	console.log("RESULT: fresh downloads, shared busy controls, failure display and retry passed");
} finally {
	release?.();
	await app?.close();
	site.close();
}
