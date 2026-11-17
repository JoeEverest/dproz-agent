import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createSandbox, launchApp, shot } from "./harness.mjs";

const sandbox = await createSandbox("questions", { settings: { onboarded: true } });
const inboxFile = path.join(sandbox.workspace, "inbox.json");
const at = (minute) => new Date(Date.UTC(2026, 10, 15, 10, minute)).toISOString();
const typed = (id, minute, text = `Question ${id}: what should the agent know?`) => ({
	id,
	question: text,
	askedAt: at(minute),
});
const quick = (id, minute) => ({ ...typed(id, minute), item: `Requirement ${id}`, category: "skills" });
const long = `Question T1: ${"Please describe your availability and the constraints that matter for this application. ".repeat(12)}End of the full question.`;
let inbox = [
	...Array.from({ length: 24 }, (_, i) => ({
		...typed(`old-${i}`, i),
		answer: `Saved answer ${i}`,
		answeredAt: at(i),
	})),
	{ ...typed("T1", 30, long), why: "The agent needs this context before proceeding with the application." },
	typed("T2", 31),
	typed("T3", 32),
];
await fs.writeFile(inboxFile, JSON.stringify(inbox));
const { app, window } = await launchApp(sandbox);
let checks = 0;
const check = (name, passed) => {
	assert.ok(passed, name);
	console.log("PASS", name);
	checks++;
};
const form = window.getByRole("form", { name: "Answer the selected question" });
const history = window.getByRole("region", { name: "Question history", exact: true });
const box = form.locator("textarea");
const prompt = (id) => inbox.find((question) => question.id === id)?.question;
const activeTyped = async (id) => {
	await form.getByRole("textbox", { name: prompt(id), exact: true }).waitFor();
};
const activeQuick = async (id) => {
	await form.locator("fieldset").getByText(`Requirement ${id}`, { exact: true }).waitFor();
};
const readInbox = async () => JSON.parse(await fs.readFile(inboxFile, "utf8"));
const refresh = async () => {
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("inbox:changed"));
	await window.waitForTimeout(150);
};
const write = async () => {
	await fs.writeFile(inboxFile, JSON.stringify(inbox));
	await refresh();
};
const pick = async (id) => {
	await history
		.locator("li[data-message]")
		.filter({ has: window.getByText(prompt(id), { exact: true }) })
		.getByRole("button", { name: "Answer this one", exact: true })
		.click();
};
const answer = async (text) => {
	await box.fill(text);
	await form.getByRole("button", { name: "Send answer", exact: true }).click();
};
const scrollMiddle = async () => {
	await history.evaluate((el) => {
		el.scrollTop = el.scrollHeight * 0.4;
	});
	await window.waitForTimeout(100);
};
const anchor = async () =>
	history.evaluate((el) => {
		const top = el.getBoundingClientRect().top;
		const message = [...el.querySelectorAll("[data-message]")].find(
			(item) => item.getBoundingClientRect().bottom > top,
		);
		return { key: message.dataset.message, offset: message.getBoundingClientRect().top - top };
	});
const anchored = async (before) =>
	history.evaluate((el, before) => {
		const message = [...el.querySelectorAll("[data-message]")].find((item) => item.dataset.message === before.key);
		return Boolean(
			message && Math.abs(message.getBoundingClientRect().top - el.getBoundingClientRect().top - before.offset) < 2,
		);
	}, before);
try {
	await window
		.getByRole("navigation")
		.getByRole("button", { name: /^Questions/ })
		.click();
	await activeTyped("T1");
	const context = form.getByRole("region", { name: "Selected question context" });
	check(
		"full long question and reason are available beside the answer",
		(await context.textContent()).includes("End of the full question.") &&
			(await context.textContent()).includes(inbox.at(-3).why),
	);
	check(
		"long context scrolls without displacing the answer controls",
		(await context.evaluate((el) => el.scrollHeight > el.clientHeight)) &&
			(await form.getByRole("button", { name: "Send answer" }).isVisible()),
	);
	console.log(await shot(window, "questions-long-context"));
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 680));
	await window.evaluate(() => {
		document.documentElement.style.fontSize = "32px";
	});
	await context.focus();
	await window.keyboard.press("End");
	await window.waitForFunction(
		() => document.querySelector('section[aria-label="Selected question context"]').scrollTop > 0,
	);
	check("long context remains keyboard-scrollable at larger text", await context.evaluate((el) => el.scrollTop > 0));
	await box.focus();
	check(
		"long context leaves the answer box reachable in a short window",
		await box.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			return rect.top >= 0 && rect.bottom <= innerHeight;
		}),
	);
	check(
		"long composer leaves history readable at larger root text",
		await history.evaluate((el) => el.clientHeight > 60),
	);
	console.log(await shot(window, "questions-long-large-text"));
	await window.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
	await window.waitForFunction(() => innerWidth < 800);
	await box.focus();
	check(
		"long composer remains usable at 150% browser zoom",
		await box.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
		}),
	);
	// Electron's native capture keeps the entire window at non-default browser zoom.
	const zoomCapture = await app.evaluate(async ({ BrowserWindow }) =>
		(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString("base64"),
	);
	const zoomShot = path.join(sandbox.base, "../shots/questions-long-browser-zoom.png");
	await fs.writeFile(zoomShot, Buffer.from(zoomCapture, "base64"));
	console.log(zoomShot);
	await app.evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);
		BrowserWindow.getAllWindows()[0].setSize(1360, 880);
	});
	await box.fill("Draft for T1");
	inbox.push(quick("Q1", 34), quick("Q2", 35));
	await write();
	check(
		"new quick questions do not interrupt a typed draft",
		(await box.inputValue()) === "Draft for T1" && (await box.getAttribute("aria-label")) === long,
	);
	await app.evaluate(async (_, inboxFile) => {
		const fs = process.getBuiltinModule("fs/promises");
		globalThis.originalReadFile = fs.readFile;
		let held = false;
		fs.readFile = async (file, ...args) => {
			const result = await globalThis.originalReadFile(file, ...args);
			if (file === inboxFile && !held) {
				held = true;
				await new Promise((resolve) => {
					globalThis.releaseOldRefresh = resolve;
				});
			}
			return result;
		};
	}, inboxFile);
	await refresh();
	inbox[0].deliveredAt = at(50);
	await write();
	await app.evaluate(async () => {
		const fs = process.getBuiltinModule("fs/promises");
		fs.readFile = globalThis.originalReadFile;
		globalThis.releaseOldRefresh();
	});
	await window.waitForTimeout(150);
	check(
		"a late older refresh does not undo a delivery acknowledgement",
		(await history.getByText("Saved to what the agent knows", { exact: false }).count()) === 1,
	);

	await pick("T3");
	await activeTyped("T3");
	check(
		"explicit selection focuses the answer without waiting for sync",
		await box.evaluate((el) => el === document.activeElement),
	);
	await box.fill("Draft for T3");
	await pick("T1");
	await activeTyped("T1");
	check("switching back restores the original draft", (await box.inputValue()) === "Draft for T1");
	await pick("T3");
	await activeTyped("T3");
	check("each selected question retains its own draft", (await box.inputValue()) === "Draft for T3");
	await app.evaluate(async (_, inboxFile) => {
		const fs = process.getBuiltinModule("fs/promises");
		globalThis.originalRename = fs.rename;
		globalThis.answerWrites = 0;
		fs.rename = async (from, to) => {
			if (to === inboxFile) {
				globalThis.answerWrites++;
				await new Promise((resolve) => {
					globalThis.releaseAnswer = resolve;
				});
			}
			return globalThis.originalRename(from, to);
		};
	}, inboxFile);
	await answer("Explicit T3 answer");
	await window.waitForFunction(
		() => document.querySelector('form[aria-label="Answer the selected question"] textarea').readOnly,
	);
	await form.evaluate((el) => el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
	check(
		"in-flight submission locks selection and retains its target",
		(await form.getByRole("button", { name: "Next question" }).isDisabled()) &&
			(await box.getAttribute("aria-label")) === prompt("T3"),
	);
	const deadline = Date.now() + 5000;
	while (!(await app.evaluate(() => Boolean(globalThis.releaseAnswer))) && Date.now() < deadline)
		await window.waitForTimeout(20);
	await app.evaluate(async () => {
		const fs = process.getBuiltinModule("fs/promises");
		fs.rename = globalThis.originalRename;
		globalThis.releaseAnswer();
	});
	await activeQuick("Q1");
	check(
		"repeated submit while saving writes only one answer",
		(await app.evaluate(() => globalThis.answerWrites)) === 1,
	);
	check(
		"explicit typed selection wins once, then resumes quick FIFO",
		(await readInbox()).find((question) => question.id === "T3").answer === "Explicit T3 answer",
	);
	inbox = await readInbox();
	inbox.push(quick("Q3", 36));
	await write();
	await activeQuick("Q1");
	await form.getByRole("button", { name: /^I have it/ }).click();
	await activeQuick("Q2");
	await form.getByRole("button", { name: /^Not yet/ }).click();
	await activeQuick("Q3");
	await form.getByRole("button", { name: /^I have it/ }).click();
	await activeTyped("T1");
	check(
		"quick arrivals preserve the current quick question and finish FIFO before typed",
		(await box.inputValue()) === "Draft for T1",
	);

	await scrollMiddle();
	const unchanged = await anchor();
	await refresh();
	check("equivalent refresh preserves the visible message and offset", await anchored(unchanged));
	await box.focus();
	await refresh();
	check(
		"unrelated sync preserves input focus and draft",
		(await box.evaluate((el) => el === document.activeElement)) && (await box.inputValue()) === "Draft for T1",
	);
	inbox = await readInbox();
	inbox[1].answer = "A much longer synchronized answer. ".repeat(40);
	inbox[2].deliveredAt = at(40);
	inbox.push(typed("T4", 40));
	await write();
	check("answer growth, delivery and new questions preserve the reading anchor", await anchored(unchanged));
	for (const running of [true, false]) {
		await app.evaluate(
			({ BrowserWindow }, running) =>
				BrowserWindow.getAllWindows()[0].webContents.send("agent:state", {
					status: running ? "running" : "idle",
					runLabel: running ? "Using your answers" : undefined,
					queued: 0,
					active: {},
					paused: true,
					browserOpen: false,
				}),
			running,
		);
		await window.waitForTimeout(100);
		check(`working status ${running ? "appears" : "clears"} without moving the reader`, await anchored(unchanged));
	}
	const arrow = window.getByRole("button", { name: "Jump to latest", exact: true });
	check("bottom arrow appears away from the end", await arrow.isVisible());
	await arrow.click();
	await arrow.waitFor({ state: "detached" });
	check(
		"bottom arrow preserves the active question and draft",
		(await box.inputValue()) === "Draft for T1" && (await box.getAttribute("aria-label")) === long,
	);
	inbox.push(typed("T5", 41));
	await write();
	check(
		"new activity is followed when already at the bottom",
		await history.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 2),
	);

	await fs.rename(inboxFile, `${inboxFile}.saved`);
	await fs.mkdir(inboxFile);
	await form.getByRole("button", { name: "Send answer" }).click();
	await form.getByRole("alert").waitFor();
	await fs.rmdir(inboxFile);
	await fs.rename(`${inboxFile}.saved`, inboxFile);
	check(
		"failed submission keeps the target and draft for retry",
		(await box.inputValue()) === "Draft for T1" && (await box.getAttribute("aria-label")) === long,
	);
	await scrollMiddle();
	const beforeAnswer = await anchor();
	await form.getByRole("button", { name: "Send answer" }).click();
	await activeTyped("T2");
	check("answering an older question preserves the reading anchor", await anchored(beforeAnswer));
	check(
		"successful retry resumes typed FIFO",
		(await readInbox()).find((question) => question.id === "T1").answer === "Draft for T1",
	);
	await box.fill("Do not attach this draft to another question");
	inbox = await readInbox();
	inbox.find((question) => question.id === "T2").answer = "Answered elsewhere";
	await write();
	await form.getByRole("button", { name: "Continue to next question" }).waitFor();
	check(
		"external resolution explains the change and retains a read-only draft",
		(await box.evaluate((el) => el.readOnly)) &&
			(await box.inputValue()) === "Do not attach this draft to another question",
	);
	check(
		"resolved question cannot accept another answer",
		await form.getByRole("button", { name: "Send answer" }).isDisabled(),
	);
	await form.getByRole("button", { name: "Continue to next question" }).click();
	await activeTyped("T4");
	check("acknowledging an external answer does not transfer its draft", (await box.inputValue()) === "");

	const jobFolder = path.join(sandbox.workspace, "applications", "context-job");
	await fs.mkdir(jobFolder, { recursive: true });
	const jobQuestion = typed("job-question", 42, "Which working hours suit you?");
	await fs.writeFile(
		path.join(jobFolder, "application.json"),
		JSON.stringify({
			id: "context-job",
			title: "Support Engineer",
			company: "Example Company",
			status: "needs_input",
			questions: [jobQuestion],
			createdAt: at(0),
			updatedAt: at(42),
			timeline: [],
		}),
	);
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("applications:changed"));
	await history.getByText(jobQuestion.question, { exact: true }).waitFor();
	await history
		.locator("li[data-message]")
		.filter({ hasText: jobQuestion.question })
		.getByRole("button", { name: "Answer this one" })
		.click();
	check(
		"selected question includes its full job context",
		(await context.textContent()).includes("Support Engineer at Example Company"),
	);
	await box.fill("Morning hours");
	await window.emulateMedia({ colorScheme: "light" });
	await window.waitForTimeout(250);
	console.log(await shot(window, "questions-context-light"));
	await pick("T4");
	await activeTyped("T4");
	await scrollMiddle();
	await window.emulateMedia({ colorScheme: "dark" });
	await window.waitForTimeout(250);
	console.log(await shot(window, "questions-history-dark"));
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 680));
	await window.evaluate(() => {
		document.documentElement.style.fontSize = "32px";
	});
	await box.fill("Still usable at larger text");
	await form.getByRole("button", { name: "Send answer" }).focus();
	check(
		"answer control remains reachable at 200% text size",
		await form.getByRole("button", { name: "Send answer" }).evaluate((el) => {
			const rect = el.getBoundingClientRect();
			return rect.top >= 0 && rect.bottom <= innerHeight;
		}),
	);
	check("history retains space beside a bounded composer", await history.evaluate((el) => el.clientHeight > 50));
	console.log(await shot(window, "questions-large-text"));
	await window.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});

	inbox = (await readInbox()).filter((question) => question.id !== "T4");
	await write();
	await form.getByRole("button", { name: "Continue to next question" }).waitFor();
	check(
		"removed question is reported before selecting another",
		await form.getByRole("button", { name: "Send answer" }).isDisabled(),
	);
	await form.getByRole("button", { name: "Continue to next question" }).click();
	await activeTyped("T5");
	await answer("Final inbox answer");
	await form.getByRole("textbox", { name: jobQuestion.question, exact: true }).waitFor();
	check("job draft survives other answers and an external removal", (await box.inputValue()) === "Morning hours");
	await form.getByRole("button", { name: "Send answer" }).click();
	await form.getByRole("textbox", { name: "Your answer", exact: true }).waitFor();
	check("all answered state disables the empty composer", await box.isDisabled());
	check(
		"job answer is saved to its original application",
		JSON.parse(await fs.readFile(path.join(jobFolder, "application.json"), "utf8")).questions[0].answer ===
			"Morning hours",
	);
	inbox = await readInbox();
	delete inbox.find((question) => question.id === "T1").answer;
	await write();
	await activeTyped("T1");
	check("a question reopened after a successful answer is available again", (await box.inputValue()) === "");
	await answer("Updated availability");
	await form.getByRole("textbox", { name: "Your answer", exact: true }).waitFor();
	inbox = [];
	await fs.rm(jobFolder, { recursive: true });
	await write();
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("applications:changed"));
	await history.getByRole("heading", { name: "No questions yet" }).waitFor();
	check("empty history retains the disabled composer", await box.isDisabled());
	console.log(`RESULT ${checks} passed, 0 failed`);
} finally {
	await app.close();
}
