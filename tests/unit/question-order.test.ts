import { describe, expect, it } from "vitest";
import { byArrival, type OpenQuestion, questionKey, questionQueue } from "../../src/renderer/src/lib/questionOrder";

const question = (id: string, askedAt: string, item?: string): OpenQuestion => ({ id, question: id, askedAt, item });

describe("question order and identity", () => {
	it("keeps history in arrival order while the automatic queue puts quick choices first", () => {
		const typed = question("typed", "2026-11-15T10:00:00Z");
		const quick = question("quick", "2026-11-15T11:00:00Z", "A licence");
		expect([quick, typed].sort(byArrival)).toEqual([typed, quick]);
		expect(questionQueue([typed, quick])).toEqual([quick, typed]);
	});
	it("uses FIFO within each group regardless of input order", () => {
		const questions = [
			question("T2", "2026-11-15T12:00:00Z"),
			question("Q2", "2026-11-15T13:00:00Z", "Second"),
			question("T1", "2026-11-15T10:00:00Z"),
			question("Q1", "2026-11-15T11:00:00Z", "First"),
		];
		expect(questionQueue(questions).map((question) => question.id)).toEqual(["Q1", "Q2", "T1", "T2"]);
		expect(questions[0].id).toBe("T2");
	});
	it("orders timestamp ties deterministically across refreshed source lists", () => {
		const first = question("a", "2026-11-15T10:00:00Z");
		const second = question("b", first.askedAt);
		expect(questionQueue([first, second])).toEqual(questionQueue([second, first]));
	});
	it("does not mix drafts or message identities for equal IDs in different jobs and inbox", () => {
		const inbox = question("shared", "2026-11-15T10:00:00Z");
		const jobA = { ...inbox, about: { id: "job-a", label: "First job" } };
		const jobB = { ...inbox, about: { id: "job-b", label: "Second job" } };
		expect(new Set([inbox, jobA, jobB].map(questionKey)).size).toBe(3);
		expect(questionKey({ ...jobA, about: { ...jobA.about, label: "Updated title" } })).toBe(questionKey(jobA));
	});
});
