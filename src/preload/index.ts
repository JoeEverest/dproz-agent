import { DESK_EVENTS, DESK_METHODS, type DeskApi, type DeskEvents } from "@shared/ipc";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const remote = Object.fromEntries(
	Object.entries(DESK_METHODS).map(([area, methods]) => [
		area,
		Object.fromEntries(
			methods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(`${area}:${method}`, ...args)]),
		),
	]),
) as unknown as Omit<DeskApi, "on" | "isDevelopment">;

const api: DeskApi = {
	...remote,
	isDevelopment: process.argv.includes("--dproz-development"),
	documents: { ...remote.documents, pathForFile: (file) => webUtils.getPathForFile(file) },
	on(channel, listener) {
		if (!DESK_EVENTS.includes(channel)) throw new Error(`Unknown event ${channel}`);
		const handler = (_event: unknown, payload: DeskEvents[typeof channel]) => listener(payload);
		ipcRenderer.on(channel, handler);
		return () => ipcRenderer.removeListener(channel, handler);
	},
};

contextBridge.exposeInMainWorld("desk", api);
