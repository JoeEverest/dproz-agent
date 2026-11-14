import type { UpdateInfo } from "@shared/ipc";
import { isNewer } from "@shared/version";
import { app } from "electron";
import { broadcast } from "./events";

/** The download site: it answers with the latest release and where to get it. Empty turns checks off. */
const UPDATE_URL = process.env.DPROZ_AGENT_UPDATE_URL ?? "https://dproz-agent.vercel.app/api/latest";
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

type Latest = { version?: string; page?: string; downloads?: Record<string, string> };

let info: UpdateInfo = { current: app.getVersion(), available: false };

const platformKey = () => ({ darwin: "mac", linux: "linux", win32: "win" })[process.platform as string] ?? "";

export const updateStatus = () => info;

export async function checkForUpdate(): Promise<UpdateInfo> {
	if (!UPDATE_URL) return info;
	try {
		const response = await fetch(UPDATE_URL, { signal: AbortSignal.timeout(15_000) });
		if (!response.ok) throw new Error(`The update server answered ${response.status}`);
		const latest = (await response.json()) as Latest;
		const available = Boolean(latest.version && isNewer(latest.version, info.current));
		info = {
			current: info.current,
			latest: latest.version,
			available,
			url: latest.downloads?.[platformKey()] ?? latest.page,
			checkedAt: new Date().toISOString(),
		};
	} catch (cause) {
		info = { ...info, checkedAt: new Date().toISOString(), error: (cause as Error).message };
	}
	broadcast("update:changed", info);
	return info;
}

export function startUpdateChecks() {
	if (!UPDATE_URL) return;
	void checkForUpdate();
	setInterval(() => void checkForUpdate(), CHECK_EVERY_MS).unref();
}
