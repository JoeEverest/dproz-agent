import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ workspaceDir: "" }));

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getPath: () => state.workspaceDir } }));
vi.mock("../../src/main/settings", () => ({ getSettings: async () => ({ workspaceDir: state.workspaceDir }) }));

const store = await import("../../src/main/applications");

beforeEach(async () => {
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

	it("answers a quick question with one click, and follows up only what the user has", async () => {
		const { application } = await store.createApplication(job);
		const asked = await store.askApplicationQuestions(application.id, [
			{ item: "Power BI", category: "skills", followUp: "Where did you use Power BI?" },
			{ item: "CPA(T) or equivalent", category: "certifications", followUp: "When did you qualify?" },
			{ question: "What salary do you expect?" },
		]);
		const [powerBi, cpa, salary] = asked.questions;
		expect(powerBi.question).toBe("Do you have this: Power BI?");

		// "I have it" leaves the question open for the follow-up, but is a fact from that moment.
		let card = await store.answerApplicationQuestion(application.id, powerBi.id, { have: true });
		expect(card.questions[0].have).toBe(true);
		expect(card.questions[0].answer).toBeUndefined();
		expect(await store.knownFact("power-bi")).toMatchObject({ have: true, answer: "I have it." });

		card = await store.answerApplicationQuestion(application.id, powerBi.id, "At Meru Dairies, for sales reports.");
		expect(card.questions[0].answer).toBe("I have it. At Meru Dairies, for sales reports.");
		expect((await store.knownFact("Power BI"))?.answer).toBe("I have it. At Meru Dairies, for sales reports.");

		// "Not yet" settles at once, with no follow-up.
		card = await store.answerApplicationQuestion(application.id, cpa.id, { have: false });
		expect(card.questions[1]).toMatchObject({ have: false, answer: "I do not have it." });

		card = await store.answerApplicationQuestion(application.id, salary.id, "TZS 2,800,000");
		expect(card.questions[2].answer).toBe("TZS 2,800,000");
		expect((await store.listFacts()).map((fact) => fact.answer)).toContain("TZS 2,800,000");
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
		// One fact, not three: the copies are the same answer.
		expect((await store.listFacts()).filter((fact) => store.sameItem(fact.item, "Sage 300"))).toHaveLength(1);
	});

	it("corrects and forgets a fact, and says what changed", async () => {
		const { application } = await store.createApplication(job);
		const asked = await store.askApplicationQuestions(application.id, [{ item: "Power BI", category: "skills" }]);
		await store.answerApplicationQuestion(application.id, asked.questions[0].id, { have: true });
		const [fact] = await store.listFacts();

		const unchanged = await store.correctFact(fact.id ?? "", { answer: "I have it.", have: true });
		expect(unchanged.change).toBeNull();

		const corrected = await store.correctFact(fact.id ?? "", { answer: "I do not have it.", have: false });
		expect(corrected.change).toBe('Power BI: they first said "I have it.". The right answer is "I do not have it.".');
		expect(corrected.facts[0]).toMatchObject({ id: fact.id, have: false, answer: "I do not have it." });
		expect(corrected.facts[0].correctedAt).toBeTruthy();
		// The corrected answer is what a later question about the same thing gets back.
		expect((await store.knownFact("power bi"))?.have).toBe(false);

		const removed = await store.removeFact(fact.id ?? "");
		expect(removed.change).toContain("withdrawn");
		expect(await store.listFacts()).toEqual([]);
		expect(await store.knownFact("Power BI")).toBeUndefined();
	});

	it("gives ids to facts kept before they could be edited", async () => {
		const file = path.join(state.workspaceDir, "facts.json");
		await fs.writeFile(
			file,
			JSON.stringify([{ at: "2026-11-14T00:00:00.000Z", question: "Notice?", answer: "One month" }]),
		);
		const [first] = await store.listFacts();
		expect(first.id).toBeTruthy();
		expect((await store.listFacts())[0].id).toBe(first.id);
	});
});
