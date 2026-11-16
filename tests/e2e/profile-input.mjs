import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

const sandbox = await createSandbox("profile-input", { settings: { onboarded: true } });
const home = path.join(sandbox.base, "home");
const documents = path.join(home, "Documents");
const uploads = path.join(home, "uploads");
const dragged = path.join(home, "dragged");
for (const directory of [documents, uploads, dragged]) await fs.mkdir(directory, { recursive: true });
const resume = path.join(uploads, "Resume.txt");
const certificate = path.join(dragged, "Certificate.txt");
await fs.writeFile(resume, "A synthetic resume for testing");
await fs.writeFile(certificate, "A synthetic certificate for testing");
let releaseLink;
let slowRequests = 0;
const server = http.createServer((request, response) => {
	if (request.url === "/slow") {
		slowRequests++;
		releaseLink = () => {
			response.setHeader("content-type", "text/html");
			response.end("<!doctype html><title>Slow portfolio</title>");
		};
	} else if (request.url === "/resume.pdf") {
		response.setHeader("content-type", "application/pdf");
		response.end("%PDF-1.4 test");
	} else {
		response.setHeader("content-type", "text/html");
		response.end("<!doctype html><title>Synthetic portfolio</title>");
	}
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let { app, window } = await launchApp(sandbox);
let checks = 0;
const check = (name, value) => {
	assert.ok(value, name);
	checks++;
	console.log("PASS", name);
};
const saved = async () => JSON.parse(await fs.readFile(path.join(sandbox.userData, "settings.json"), "utf8"));
const configurePicker = async () => {
	await app.evaluate(
		({ app, dialog }, paths) => {
			app.setPath("home", paths.home);
			app.setPath("documents", paths.documents);
			globalThis.pickerResult = { canceled: true, filePaths: [] };
			globalThis.pickerOptions = [];
			dialog.showOpenDialog = async (options) => {
				globalThis.pickerOptions.push(options);
				if (globalThis.pickerError) throw new Error("Synthetic picker failure");
				return globalThis.pickerResult;
			};
		},
		{ home, documents },
	);
};
const choose = async (files = [], canceled = false) => {
	await app.evaluate(
		(_, result) => {
			globalThis.pickerResult = result;
		},
		{ canceled, filePaths: files },
	);
	await window.getByRole("button", { name: "Choose files" }).click();
	await window.getByRole("button", { name: "Choose files" }).waitFor();
	await window.waitForFunction(() => !document.querySelector('section[aria-label="Add documents"] button').disabled);
	return app.evaluate(() => globalThis.pickerOptions.at(-1).defaultPath);
};
const openProfile = async () => {
	await window.getByRole("button", { name: "Profile settings", exact: true }).click();
	await window.getByRole("heading", { name: "Your documents" }).waitFor();
};
const dropUrl = async (url) => {
	await window
		.getByRole("region", { name: "Add documents" })
		.locator(".border-dashed")
		.evaluate((target, url) => {
			const dataTransfer = new DataTransfer();
			dataTransfer.setData("text/uri-list", url);
			target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
		}, url);
};
try {
	await configurePicker();
	await openProfile();
	check(
		"empty Profile shows input controls before the empty list",
		await window.getByText("No documents yet.", { exact: false }).isVisible(),
	);
	console.log(await shot(window, "profile-input-empty"));
	check("first picker uses system Documents", (await choose([], true)) === documents);
	check("cancellation does not save a source directory", !(await saved()).lastDocumentDirectory);
	await choose([resume]);
	await window.getByRole("button", { name: "Preview Resume.txt", exact: true }).waitFor();
	check("successful picker import remembers its source", (await saved()).lastDocumentDirectory === uploads);
	check("next picker starts at that source", (await choose([], true)) === uploads);
	check("cancellation retains the source", (await saved()).lastDocumentDirectory === uploads);
	console.log(await shot(window, "profile-input-one"));

	const cdp = await window.context().newCDPSession(window);
	const target = await window.getByRole("region", { name: "Add documents" }).locator(".border-dashed").boundingBox();
	const data = { items: [], files: [certificate], dragOperationsMask: 1 };
	for (const type of ["dragEnter", "dragOver", "drop"]) {
		await cdp.send("Input.dispatchDragEvent", { type, x: target.x + 10, y: target.y + 10, data });
	}
	await window.getByRole("button", { name: "Preview Certificate.txt", exact: true }).waitFor();
	check("native file drop remembers the original source", (await saved()).lastDocumentDirectory === dragged);
	check("one drop imports only one copy", (await fs.readdir(path.join(sandbox.workspace, "documents"))).length === 2);

	const field = window.getByRole("textbox", { name: "Link to a page or file about you" });
	await field.fill("not a link");
	await window.getByRole("button", { name: "Add link", exact: true }).click();
	check(
		"invalid link reports an error and retains the input",
		(await field.inputValue()) === "not a link" &&
			(await window.getByText("That does not look like a web link.").isVisible()),
	);
	await field.fill(`${origin}/portfolio`);
	await field.press("Tab");
	check(
		"keyboard reaches the link action",
		await window.getByRole("button", { name: "Add link", exact: true }).evaluate((el) => el === document.activeElement),
	);
	await window.keyboard.press("Enter");
	await window.getByRole("button", { name: /Remove the link to/ }).waitFor();
	await dropUrl(`${origin}/resume.pdf`);
	await window.getByRole("button", { name: "Preview resume.pdf", exact: true }).waitFor();
	check(
		"page and file links leave the local source directory alone",
		(await saved()).lastDocumentDirectory === dragged,
	);
	check(
		"additions are queued for the paused agent",
		(await window.evaluate(() => window.desk.agent.state())).queued >= 4,
	);

	await field.fill(`${origin}/slow`);
	await window.getByRole("button", { name: "Add link", exact: true }).click();
	await window.waitForFunction(() => document.querySelector('section[aria-label="Add documents"] input').disabled);
	check("link import disables file selection", await window.getByRole("button", { name: "Choose files" }).isDisabled());
	await field.evaluate((el) =>
		el.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	);
	await dropUrl(`${origin}/ignored-during-import`);
	const deadline = Date.now() + 5000;
	while (!releaseLink && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(releaseLink, "the synthetic link request reached the server");
	releaseLink();
	await window.waitForFunction(() => !document.querySelector('section[aria-label="Add documents"] input').disabled);
	const linksFile = path.join(sandbox.workspace, "links.json");
	const storedLinks = JSON.parse(await fs.readFile(linksFile, "utf8"));
	check("repeat submit and overlapping drop do not duplicate imports", slowRequests === 1 && storedLinks.length === 2);

	await fs.rename(linksFile, `${linksFile}.saved`);
	await fs.mkdir(linksFile);
	try {
		await field.fill(`${origin}/cannot-save`);
		await window.getByRole("button", { name: "Add link", exact: true }).click();
		await window.getByText("The link was not added. Try again.").waitFor();
		check(
			"failed link save keeps the user's draft and source directory",
			(await field.inputValue()) === `${origin}/cannot-save` && (await saved()).lastDocumentDirectory === dragged,
		);
	} finally {
		await fs.rmdir(linksFile);
		await fs.rename(`${linksFile}.saved`, linksFile);
	}
	await field.fill("");

	await app.evaluate(() => {
		globalThis.pickerError = true;
	});
	await choose();
	check(
		"picker failure has visible feedback",
		await window.getByRole("alert").filter({ hasText: "Some documents could not be added" }).isVisible(),
	);
	check("picker failure retains the directory", (await saved()).lastDocumentDirectory === dragged);
	await app.evaluate(() => {
		globalThis.pickerError = false;
	});

	const many = [];
	for (let i = 0; i < 30; i++) {
		const file = path.join(uploads, `Reference ${String(i).padStart(2, "0")} with a long descriptive filename.txt`);
		await fs.writeFile(file, "Synthetic reference");
		many.push(file);
	}
	await choose(many);
	const group = window.getByRole("region", { name: "Add documents" });
	const list = window.getByRole("list", { name: "Saved documents and links" });
	const before = await group.boundingBox();
	await list.evaluate((el) => {
		el.parentElement.scrollTop = el.parentElement.scrollHeight;
	});
	const after = await group.boundingBox();
	check("scrolling a long list does not move the input group", before.y === after.y && before.height === after.height);
	check("the list has its own scroll area", await list.evaluate((el) => el.parentElement.scrollTop > 0));
	await window.emulateMedia({ colorScheme: "light" });
	console.log(await shot(window, "profile-input-long-light"));
	await window.emulateMedia({ colorScheme: "dark" });
	await window.waitForTimeout(300);
	console.log(await shot(window, "profile-input-long-dark"));

	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 680));
	await window.evaluate(() => {
		document.documentElement.style.fontSize = "32px";
	});
	await field.fill(`${origin}/another-page`);
	await field.press("Tab");
	check(
		"larger text can reach the link action by keyboard",
		await window.getByRole("button", { name: "Add link", exact: true }).evaluate((el) => {
			const rect = el.getBoundingClientRect();
			const panel = el.closest("section").getBoundingClientRect();
			return el === document.activeElement && rect.bottom <= panel.bottom && rect.top >= panel.top;
		}),
	);
	check(
		"short window with larger text retains a usable list",
		await list.evaluate((el) => el.parentElement.clientHeight >= 100),
	);
	check("input group has no horizontal overflow", await group.evaluate((el) => el.scrollWidth <= el.clientWidth));
	console.log(await shot(window, "profile-input-short-large-text"));
	await window.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});
	await window.getByRole("button", { name: "Preview Resume.txt", exact: true }).click();
	await window.getByRole("complementary", { name: "Preview of Resume.txt" }).waitFor();
	check("preview still opens beside the document list", true);
	await window.getByRole("button", { name: "Close the preview" }).click();
	await window.getByRole("button", { name: "Remove Resume.txt", exact: true }).click();
	await window.getByRole("button", { name: "Preview Resume.txt", exact: true }).waitFor({ state: "detached" });
	check(
		"document removal still works",
		!(await fs.readdir(path.join(sandbox.workspace, "documents"))).includes("Resume.txt"),
	);

	await app.close();
	({ app, window } = await launchApp(sandbox));
	await configurePicker();
	await openProfile();
	check("source directory survives a full app restart", (await choose([], true)) === uploads);
	await fs.rename(uploads, `${uploads}-moved`);
	check("moved source falls back to Documents", (await choose([], true)) === documents);
	await fs.rmdir(documents);
	check("missing Documents falls back to Home", (await choose([], true)) === home);
	await fs.mkdir(documents);
	await app.evaluate(({ app }) => {
		globalThis.originalGetPath = app.getPath.bind(app);
		app.getPath = (name) => {
			if (name === "documents") throw new Error("System Documents unavailable");
			return globalThis.originalGetPath(name);
		};
	});
	try {
		check("unresolvable system Documents falls back to Home", (await choose([], true)) === home);
	} finally {
		await app.evaluate(({ app }) => {
			app.getPath = globalThis.originalGetPath;
		});
	}
	await window.evaluate((directory) => window.desk.settings.update({ lastDocumentDirectory: directory }), certificate);
	check("a file cannot be used as the picker directory", (await choose([], true)) === documents);
	if (process.platform !== "win32" && process.getuid?.() !== 0) {
		await window.evaluate((directory) => window.desk.settings.update({ lastDocumentDirectory: directory }), dragged);
		await fs.chmod(dragged, 0);
		try {
			check("inaccessible source falls back to Documents", (await choose([], true)) === documents);
		} finally {
			await fs.chmod(dragged, 0o700);
		}
	}
	console.log(`RESULT ${checks} passed, 0 failed`);
} finally {
	await app.close();
	await new Promise((resolve) => server.close(resolve));
}
