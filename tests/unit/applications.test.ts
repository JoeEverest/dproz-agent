import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_STATUSES, reassessable } from "../../src/shared/application";

const state = vi.hoisted(() => ({ workspaceDir: "", lastDocumentDirectory: undefined as string | undefined }));

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getPath: () => state.workspaceDir } }));
vi.mock("../../src/main/settings", () => ({
	getSettings: async () => ({ workspaceDir: state.workspaceDir }),
	updateSettings: async (patch: object) => Object.assign(state, patch),
}));

const store = await import("../../src/main/applications");

beforeEach(async () => {
	state.lastDocumentDirectory = undefined;
	state.workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "dproz-agent-"));
});

const job = { title: "Finance Officer", company: "Kilele Foods Ltd", source: "dproz", sourceJobId: "abc123" };

describe("application store", () => {
	it("creates a card in its own folder with a readable id", async () => {
		const { application, created } = await store.createApplication(job);
		expect(created).toBe(true);
		expect(application.id).toBe("kilele-foods-ltd-finance-officer");
		expect(application.status).toBe("found");
		const saved = JSON.parse(
			await fs.readFile(path.join(state.workspaceDir, "applications", application.id, "application.json"), "utf8"),
		);
		expect(saved.title).toBe("Finance Officer");
	});

	it("returns the existing card instead of adding the same job twice", async () => {
		const first = await store.createApplication(job);
		const second = await store.createApplication({ ...job, title: "Finance Officer (reposted)" });
		expect(second.created).toBe(false);
		expect(second.application.id).toBe(first.application.id);
		expect(await store.listApplications()).toHaveLength(1);
	});

	it("gives two different jobs with the same name separate folders", async () => {
		const first = await store.createApplication(job);
		const second = await store.createApplication({ ...job, sourceJobId: "def456" });
		expect(second.application.id).toBe(`${first.application.id}-2`);
	});

	it("records status moves in the card history and tells listeners", async () => {
		const moves: string[] = [];
		const stop = store.onStatusChange((application, previous) => moves.push(`${previous}>${application.status}`));
		const { application } = await store.createApplication(job);
		const applied = await store.patchApplication(application.id, { status: "applied" }, "Reference KF-1042");
		stop();
		expect(applied.timeline.map((entry) => entry.event)).toEqual(["Found", "Moved to Applied", "Reference KF-1042"]);
		expect(moves).toEqual(["null>found", "found>applied"]);
	});

	it("moves a card to needs_input when the agent asks, and delivers each answer exactly once", async () => {
		const { application } = await store.createApplication(job);
		const asked = await store.askApplicationQuestions(application.id, [{ question: "Do you hold a class B licence?" }]);
		expect(asked.status).toBe("needs_input");
		expect(await store.hasUndeliveredAnswers()).toBe(false);

		await store.answerApplicationQuestion(application.id, asked.questions[0].id, "Yes, valid to 2029");
		await store.askInboxQuestions([{ question: "Salary floor?" }]);
		const [inboxQuestion] = await store.listInbox();
		await store.answerInboxQuestion(inboxQuestion.id, "TZS 2,800,000");
		expect(await store.hasUndeliveredAnswers()).toBe(true);

		const delivered = await store.collectUndeliveredAnswers();
		expect(delivered.map((answer) => answer.answer).sort()).toEqual(["TZS 2,800,000", "Yes, valid to 2029"]);
		expect(delivered.find((answer) => answer.applicationId)?.application).toBe("Finance Officer at Kilele Foods Ltd");
		expect(await store.collectUndeliveredAnswers()).toEqual([]);
	});

	it("skips a folder whose application.json the agent left malformed", async () => {
		await store.createApplication(job);
		const broken = path.join(state.workspaceDir, "applications", "broken");
		await fs.mkdir(broken, { recursive: true });
		await fs.writeFile(path.join(broken, "application.json"), '{"title": 3}');
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await store.listApplications()).toHaveLength(1);
		warn.mockRestore();
	});

	it("answers a quick question with one click, and that is the whole answer", async () => {
		const { application } = await store.createApplication(job);
		const asked = await store.askApplicationQuestions(application.id, [
			{ item: "Power BI", category: "skills" },
			{ item: "CPA(T) or equivalent", category: "certifications" },
			{ question: "What salary do you expect?" },
		]);
		const [powerBi, cpa, salary] = asked.questions;
		expect(powerBi.question).toBe("Do you have this: Power BI?");

		let card = await store.answerApplicationQuestion(application.id, powerBi.id, { have: true });
		expect(card.questions[0]).toMatchObject({ have: true, answer: "I have it." });
		expect(await store.hasUndeliveredAnswers()).toBe(true);

		card = await store.answerApplicationQuestion(application.id, cpa.id, { have: false });
		expect(card.questions[1]).toMatchObject({ have: false, answer: "I do not have it." });

		card = await store.answerApplicationQuestion(application.id, salary.id, "TZS 2,800,000");
		expect(card.questions[2].answer).toBe("TZS 2,800,000");
		expect((await store.collectUndeliveredAnswers()).map((answer) => answer.have)).toEqual([true, false, undefined]);
	});

	it("answers the same requirement wherever else it is waiting", async () => {
		const first = await store.createApplication(job);
		const second = await store.createApplication({ ...job, title: "Accountant", sourceJobId: "def456" });
		const asked = await store.askApplicationQuestions(first.application.id, [{ item: "Sage 300" }]);
		await store.askApplicationQuestions(second.application.id, [{ item: "sage 300" }]);
		await store.askInboxQuestions([{ item: "Sage-300" }, { item: "Tally" }]);

		await store.answerApplicationQuestion(first.application.id, asked.questions[0].id, { have: true });

		expect((await store.getApplication(second.application.id)).questions[0]).toMatchObject({
			have: true,
			answer: "I have it.",
		});
		const inbox = await store.listInbox();
		expect(inbox[0].answer).toBe("I have it.");
		expect(inbox[1].answer).toBeUndefined();
	});

	it("keeps a record of what was asked, answered or not, for the agent alone", async () => {
		const { application } = await store.createApplication(job);
		await store.askInboxQuestions([{ question: "What salary do you expect?" }, { question: "When can you start?" }]);
		const asked = await store.askApplicationQuestions(application.id, [{ item: "Power BI" }]);
		const [salary] = await store.listInbox();
		await store.answerInboxQuestion(salary.id, "TZS 2,800,000");
		await store.answerApplicationQuestion(application.id, asked.questions[0].id, { have: false });

		const record = await store.listAsked();
		expect(record).toHaveLength(3);
		expect(record).toContainEqual({ question: "What salary do you expect?", answer: "TZS 2,800,000" });
		expect(record).toContainEqual({ question: "When can you start?", answer: null });
		expect(record).toContainEqual({
			question: "Do you have this: Power BI?",
			answer: "I do not have it.",
			application: "Finance Officer at Kilele Foods Ltd",
		});
	});
});

describe("asking the agent to reassess a job", () => {
	it("notes the request and what changed on that card, and nowhere else", async () => {
		const { application } = await store.createApplication(job);
		await store.patchApplication(application.id, { status: "closed", closedReason: "Needs five years in FMCG" });
		await store.checkReassessable(application.id);
		const noted = await store.startReassessment(application.id, "  I'd like to apply despite the travel.  ");

		expect(noted.status).toBe("closed");
		expect(noted.timeline.at(-1)?.event).toBe(
			`You asked the agent to reassess this: "I'd like to apply despite the travel."`,
		);
		expect(await store.listInbox()).toEqual([]);
		expect(await store.hasUndeliveredAnswers()).toBe(false);
	});

	it("notes a request with nothing said", async () => {
		const { application } = await store.createApplication(job);
		const noted = await store.startReassessment(application.id, "   ");
		expect(noted.timeline.at(-1)?.event).toBe("You asked the agent to reassess this");
	});

	it("refuses an application that has already been sent, and leaves its history alone", async () => {
		const { application } = await store.createApplication(job);
		for (const status of ["applied", "interview"] as const) {
			await store.patchApplication(application.id, { status });
			const before = (await store.getApplication(application.id)).timeline;
			await expect(store.checkReassessable(application.id)).rejects.toThrow("already been sent");
			await expect(store.startReassessment(application.id, "Try again")).rejects.toThrow("already been sent");
			expect((await store.getApplication(application.id)).timeline).toEqual(before);
		}
	});

	it("allows every card that has not been sent", () => {
		expect(APPLICATION_STATUSES.filter(reassessable)).toEqual([
			"found",
			"needs_input",
			"ready_to_submit",
			"manual",
			"closed",
		]);
	});
});

describe("documents attached to an answer", () => {
	const attachment = async (name: string) => {
		const folder = await fs.mkdtemp(path.join(os.tmpdir(), "dproz-attach-"));
		const file = path.join(folder, name);
		await fs.writeFile(file, `Synthetic ${name}`);
		return file;
	};
	const documentsDir = () => path.join(state.workspaceDir, "documents");

	it("copies the files into documents/ and gives their stored names to the agent with the answer", async () => {
		await store.askInboxQuestions([{ item: "A CPA certificate", category: "certifications" }]);
		const [question] = await store.listInbox();
		await fs.mkdir(documentsDir(), { recursive: true });
		await fs.writeFile(path.join(documentsDir(), "certificate.pdf"), "Already in the profile");

		const file = await attachment("certificate.pdf");
		await store.answerInboxQuestion(question.id, { have: true }, [file]);
		expect(state.lastDocumentDirectory).toBe(path.dirname(file));
		const [answered] = await store.listInbox();
		expect(answered).toMatchObject({ have: true, answer: "I have it.", documents: ["certificate 2.pdf"] });
		expect(await fs.readFile(path.join(documentsDir(), "certificate.pdf"), "utf8")).toBe("Already in the profile");
		const [delivered] = await store.collectUndeliveredAnswers();
		expect(delivered.documents).toEqual(["certificate 2.pdf"]);
	});

	it("records an answer made only of files as those files", async () => {
		await store.askInboxQuestions([{ question: "Can you share your transcript?" }]);
		const [question] = await store.listInbox();
		await store.answerInboxQuestion(question.id, "  ", [await attachment("transcript.pdf")]);
		const [answered] = await store.listInbox();
		expect(answered.answer).toBe("Attached transcript.pdf.");
		expect(answered.documents).toEqual(["transcript.pdf"]);
	});

	it("keeps neither the answer nor any copied file when a file cannot be read", async () => {
		const { application } = await store.createApplication(job);
		const asked = await store.askApplicationQuestions(application.id, [{ question: "Referee?" }]);
		const missing = path.join(os.tmpdir(), "dproz-no-such-file.pdf");
		await expect(
			store.answerApplicationQuestion(application.id, asked.questions[0].id, "See attached", [
				await attachment("reference.pdf"),
				missing,
			]),
		).rejects.toThrow("dproz-no-such-file.pdf could not be read");
		expect((await store.getApplication(application.id)).questions[0].answer).toBeUndefined();
		expect(await fs.readdir(documentsDir())).toEqual([]);
		expect(state.lastDocumentDirectory).toBeUndefined();
	});

	it("copies nothing when the question is no longer waiting", async () => {
		await expect(store.answerInboxQuestion("gone", "Here", [await attachment("letter.pdf")])).rejects.toThrow(
			"no longer waiting",
		);
		expect(await fs.readdir(documentsDir()).catch(() => [])).toEqual([]);
	});

	it("still needs text or a file", async () => {
		await store.askInboxQuestions([{ question: "Start date?" }]);
		const [question] = await store.listInbox();
		await expect(store.answerInboxQuestion(question.id, " ")).rejects.toThrow("needs some text or a document");
	});
});
