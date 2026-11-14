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
});
