import type { DeskEvents } from "@shared/ipc";
import { BrowserWindow } from "electron";

export function broadcast<K extends keyof DeskEvents>(channel: K, payload: DeskEvents[K]) {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(channel, payload);
	}
}
