// A real in-place update on macOS, start to finish: a packaged copy of the app downloads a newer
// version from a stand-in for the download site, checks it, swaps its own bundle and opens again.
//
// Needs two builds first:
//   npm run build && npx electron-builder --mac dir
//   npx electron-builder --mac zip -c.extraMetadata.version=9.9.9 -c.directories.output=dist/update-test
//
// The copy that gets replaced lives in the sandbox, and the reopened app is handed the sandbox's
// settings, so nothing here touches an installed Dproz Agent or its data.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { createSandbox, shot } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEWER = "9.9.9";
const built = path.join(root, `dist/mac-${process.arch}/Dproz Agent.app`);
const zip = path.join(root, `dist/update-test/Dproz-Agent-${NEWER}-mac-${process.arch}.zip`);

const results = [];
const check = (name, passed, detail = "") => {
	results.push(Boolean(passed));
	console.log(passed ? "PASS" : "FAIL", name, detail);
};
const versionOf = (bundle) =>
	execFileSync("/usr/bin/plutil", [
		"-extract",
		"CFBundleShortVersionString",
		"raw",
		"-o",
		"-",
		path.join(bundle, "Contents/Info.plist"),
	])
		.toString()
		.trim();
const running = (bundle) => {
	try {
		return execFileSync("/usr/bin/pgrep", ["-f", `${bundle}/Contents/MacOS/`])
			.toString()
			.trim()
			.split("\n");
	} catch {
		return [];
	}
};
const until = async (test, timeout = 60_000) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await test()) return true;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
};

const sandbox = await createSandbox("update", { settings: { onboarded: true } });
const installed = path.join(sandbox.base, "installed/Dproz Agent.app");
await fs.mkdir(path.dirname(installed), { recursive: true });
// ditto keeps the bundle's symlinks and its ad-hoc signature, as dragging it to Applications would.
execFileSync("/usr/bin/ditto", [built, installed]);
const older = versionOf(installed);

const zipBytes = await fs.readFile(zip);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
let advertised = sha256;
const site = http.createServer((request, response) => {
	if (request.url.startsWith("/package.zip")) {
		response.setHeader("content-length", zipBytes.byteLength);
		createReadStream(zip).pipe(response);
		return;
	}
	const origin = `http://127.0.0.1:${site.address().port}`;
	response.setHeader("content-type", "application/json");
	response.end(
		JSON.stringify({
			version: NEWER,
			page: "https://example.com/",
			downloads: { mac: "https://example.com/mac" },
			updates: {
				mac: { name: path.basename(zip), size: zipBytes.byteLength, url: `${origin}/package.zip`, sha256: advertised },
			},
		}),
	);
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));

const launch = async () => {
	const app = await electron.launch({
		executablePath: path.join(installed, "Contents/MacOS/Dproz Agent"),
		env: {
			...process.env,
			DPROZ_AGENT_USER_DATA: sandbox.userData,
			DPROZ_AGENT_NO_TRAY: "1",
			DPROZ_AGENT_MOCK_KEYCHAIN: "1",
			DPROZ_AGENT_QUIET_WINDOW: "1",
			DPROZ_AGENT_UPDATE_URL: `http://127.0.0.1:${site.address().port}/api/latest`,
			DPROZ_AGENT_ANTHROPIC_URL: "http://127.0.0.1:9",
		},
	});
	const window = await app.firstWindow();
	await window.getByRole("button", { name: "Settings", exact: true }).click();
	return { app, window };
};

try {
	// A download that does not match its checksum is thrown away, and the link is offered instead.
	advertised = "0".repeat(64);
	let { app, window } = await launch();
	await window.getByRole("button", { name: `Update to ${NEWER}` }).click();
	await window.getByRole("button", { name: `Download ${NEWER}` }).waitFor({ timeout: 120_000 });
	check(
		"a download that fails its checksum is refused",
		(await window.getByText("did not match its checksum").count()) === 1 && versionOf(installed) === older,
	);
	const leftovers = await fs.readdir(path.join(sandbox.userData, "updates")).catch(() => []);
	check("and deleted", leftovers.length === 0, leftovers.join(", "));
	console.log(await shot(window, "update-refused"));
	await app.close();

	advertised = sha256;
	({ app, window } = await launch());
	const sidebar = window.getByRole("navigation");
	await sidebar.getByRole("button", { name: /Update now/ }).waitFor({ timeout: 15_000 });
	check("the sidebar offers the update", true);
	console.log(await shot(window, "update-offered"));
	await window.getByRole("button", { name: `Update to ${NEWER}` }).click();
	const downloading = await window
		.getByText(/Downloading \d+%/)
		.waitFor({ timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	check("it shows the download's progress", downloading);
	if (downloading) console.log(await shot(window, "update-downloading"));
	await window.getByRole("button", { name: "Restart to update", exact: true }).waitFor({ timeout: 120_000 });
	check(
		"the sidebar turns into restart",
		(await sidebar.getByRole("button", { name: /Restart to update/ }).count()) === 1,
	);
	check("nothing is replaced before the restart", versionOf(installed) === older);
	console.log(await shot(window, "update-ready"));

	const before = running(installed);
	const closed = new Promise((resolve) => app.process().once("exit", resolve));
	await window.getByRole("button", { name: "Restart to update", exact: true }).click();
	await closed;
	check("the app quits", true);
	check(
		`the bundle is swapped for version ${NEWER}`,
		await until(() => versionOf(installed) === NEWER),
		`was ${older}, now ${versionOf(installed)}`,
	);
	const reopened = await until(() => running(installed).some((pid) => !before.includes(pid)));
	check("the new version opens by itself", reopened);
	// The reopened app clears its update folder at start, which only happens if it was handed this sandbox.
	check(
		"and it opened on the same data",
		await until(() =>
			fs.access(path.join(sandbox.userData, "updates")).then(
				() => false,
				() => true,
			),
		),
	);
	const strays = (await fs.readdir(path.dirname(installed))).filter((name) => name.includes(".old-"));
	check("the old version is cleaned up", strays.length === 0, strays.join(", "));
	execFileSync("/usr/bin/codesign", ["--verify", "--deep", installed]);
	check("the new bundle's signature is intact", true);
} catch (error) {
	check("no harness error", false, error.stack);
} finally {
	for (const pid of running(installed)) {
		try {
			process.kill(Number(pid));
		} catch {}
	}
	site.close();
	console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
	process.exit(results.every(Boolean) ? 0 : 1);
}
