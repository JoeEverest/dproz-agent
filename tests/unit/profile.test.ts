import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changedLines } from "../../src/main/agent/changes";

const state = vi.hoisted(() => ({ workspaceDir: "" }));

vi.mock("../../src/main/settings", () => ({ getSettings: async () => ({ workspaceDir: state.workspaceDir }) }));

const workspace = await import("../../src/main/workspace");

beforeEach(async () => {
	state.workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "dproz-agent-"));
});

describe("the master resume", () => {
	it("starts with a section for everything, including facts only some jobs need", async () => {
		const text = await workspace.readAboutMe();
		for (const section of ["Experience", "Certifications and licences", "Skills", "Other facts", "Do not have"]) {
			expect(text).toContain(`## ${section}`);
		}
	});

	it("saves the user's edit when the file is as they found it", async () => {
		const base = await workspace.readAboutMe();
		const edited = `${base}\n- Class B driving licence`;
		expect(await workspace.writeAboutMe(edited, base)).toEqual({ saved: true, previous: base });
		expect(await workspace.readAboutMe()).toBe(edited);
	});

	it("does not overwrite what the agent wrote while the user was editing", async () => {
		const base = await workspace.readAboutMe();
		const agents = `${base}\n- Sage 300`;
		await fs.writeFile(path.join(state.workspaceDir, "about-me.md"), agents);

		expect(await workspace.writeAboutMe(`${base}\n- Tally`, base)).toEqual({ saved: false, current: agents });
		expect(await workspace.readAboutMe()).toBe(agents);
		// The user can still choose their version over the agent's.
		expect((await workspace.writeAboutMe(`${base}\n- Tally`)).saved).toBe(true);
	});
});

describe("changedLines", () => {
	it("gives what an edit took out and put in, ignoring moved and blank lines", () => {
		const before = "## Skills\n- Excel\n- Power BI\n\n## Other facts\n- Class B licence";
		const after = "## Other facts\n- Class B and C licence\n\n## Skills\n- Excel\n\n## Do not have\n- Power BI (asked)";
		expect(changedLines(before, after)).toEqual({
			removed: ["- Power BI", "- Class B licence"],
			added: ["- Class B and C licence", "## Do not have", "- Power BI (asked)"],
		});
		expect(changedLines(before, `\n${before}\n`)).toEqual({ removed: [], added: [] });
	});
});
