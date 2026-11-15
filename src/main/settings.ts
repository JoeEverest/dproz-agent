import path from "node:path";
import type { Settings } from "@shared/ipc";
import { app } from "electron";
import { readJson, writeJson } from "./files";

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

const defaults = (): Settings => ({
	questionSendShortcut: "mod+enter",
	workspaceDir: path.join(app.getPath("userData"), "workspace"),
	autoSubmit: true,
	paused: false,
	sweepIntervalHours: 6,
	model: "",
	onboarded: false,
	shareUsage: true,
});

let cached: Settings | null = null;

export async function getSettings(): Promise<Settings> {
	if (!cached) cached = { ...defaults(), ...(await readJson<Partial<Settings>>(settingsFile(), {})) };
	cached.questionSendShortcut = cached.questionSendShortcut === "enter" ? "enter" : "mod+enter";
	return cached;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
	cached = { ...(await getSettings()), ...patch };
	cached.questionSendShortcut = cached.questionSendShortcut === "enter" ? "enter" : "mod+enter";
	await writeJson(settingsFile(), cached);
	return cached;
}
