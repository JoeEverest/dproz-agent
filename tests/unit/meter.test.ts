import { describe, expect, it } from "vitest";
import { outcomeFromCard, RunMeter, reportOutcome } from "../../src/main/agent/meter";

describe("reportOutcome", () => {
	it("reads the verdict from the last line of a subagent's report", () => {
		expect(reportOutcome("I checked the posting.\n\nREADY: the resume and cover letter are in the folder.")).toBe(
			"READY",
		);
		expect(reportOutcome("REVISE\n1. The summary names the employer.")).toBe("REVISE");
		expect(reportOutcome("The form was READY to send.\nNEEDS_INPUT: it asks for a start date.")).toBe("NEEDS_INPUT");
		expect(reportOutcome("Something went wrong.")).toBe("UNKNOWN");
	});

	it("takes a sender's other words for the same thing", () => {
		expect(reportOutcome("SENT: submitted on the careers portal, reference KF-1042.")).toBe("APPLIED");
	});
});

describe("outcomeFromCard", () => {
	it("reads an ending the report did not give from where the card was left", () => {
		expect(outcomeFromCard("send", "UNKNOWN", "applied")).toBe("APPLIED");
		expect(outcomeFromCard("send", "UNKNOWN", "needs_input")).toBe("NEEDS_INPUT");
		expect(outcomeFromCard("write", "UNKNOWN", "manual")).toBe("MANUAL");
		expect(outcomeFromCard("write", "UNKNOWN", "closed")).toBe("CLOSED");
	});

	it("leaves a verdict the report gave, and an ending the card cannot tell", () => {
		expect(outcomeFromCard("send", "NEEDS_INPUT", "applied")).toBe("NEEDS_INPUT");
		expect(outcomeFromCard("write", "UNKNOWN", "found")).toBe("UNKNOWN");
		expect(outcomeFromCard("judge", "UNKNOWN", "applied")).toBe("UNKNOWN");
		expect(outcomeFromCard("send", "UNKNOWN", undefined)).toBe("UNKNOWN");
	});
});

describe("RunMeter", () => {
	it("splits a run's cost between the coordinator and each step by the tokens they used", () => {
		let time = 0;
		const meter = new RunMeter(() => time);
		meter.spend(null, "m1", { input_tokens: 1000 });
		meter.begin("write-1", "application-writer", "acme-accountant");
		meter.begin("judge-1", "application-judge", "acme-accountant");
		// One response arrives once per content block, with the same usage each time.
		meter.spend("write-1", "m2", { input_tokens: 2000, output_tokens: 200 });
		meter.spend("write-1", "m2", { input_tokens: 2000, output_tokens: 200 });
		meter.spend("judge-1", "m3", { input_tokens: 500, cache_read_input_tokens: 5000 });
		time = 90_000;
		// A subagent in the background: the tool hands back a placeholder, the verdict is in what the subagent
		// said last, and a notification says it is over.
		meter.note("write-1", "Async agent launched. You will be notified when it completes.");
		meter.note("write-1", "READY: both documents are in the folder.");
		meter.end("write-1", "completed", "Agent finished");
		time = 120_000;
		// A subagent in the foreground: the tool hands back its report.
		meter.end("judge-1", "completed", "REVISE\n1. Cut the summary.");

		const report = meter.settle(1);
		expect(report.steps).toEqual([
			expect.objectContaining({
				step: "write",
				applicationId: "acme-accountant",
				outcome: "READY",
				durationMs: 90_000,
			}),
			expect.objectContaining({
				step: "judge",
				applicationId: "acme-accountant",
				outcome: "REVISE",
				durationMs: 120_000,
			}),
		]);
		// Weights: coordinator 1000, writer 2000 + 200 × 5 = 3000, judge 500 + 5000 × 0.1 = 1000.
		expect(report.coordinatorCostUsd).toBeCloseTo(0.2);
		expect(report.steps[0].costUsd).toBeCloseTo(0.6);
		expect(report.steps[1].costUsd).toBeCloseTo(0.2);
		expect(report.tokens).toBe(1000 + 2200 + 5500);
	});

	it("reports a step that failed or never came back, and no cost when the run gave none", () => {
		const meter = new RunMeter(() => 0);
		meter.begin("send-1", "application-sender", "acme-accountant");
		meter.begin("send-2", "application-sender", "beta-analyst");
		meter.begin("send-3", "application-sender", "gamma-clerk");
		meter.begin("other-1", "general-purpose");
		meter.end("send-1", "failed");
		meter.note("send-3", "APPLIED: the confirmation page gave reference 4411.");
		meter.end("send-3", "stopped");
		meter.end("other-1", "completed", "Done.");
		const { steps, coordinatorCostUsd } = meter.settle(undefined);
		expect(steps.map((step) => [step.step, step.outcome, step.costUsd])).toEqual([
			["send", "ERROR", null],
			["send", "INTERRUPTED", null],
			["send", "INTERRUPTED", null],
			["other", "UNKNOWN", null],
		]);
		expect(coordinatorCostUsd).toBeNull();
	});
});
