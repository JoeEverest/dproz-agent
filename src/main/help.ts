import { randomUUID } from "node:crypto";
import type { HelpRequest } from "@shared/ipc";
import { broadcast } from "./events";
import { notify } from "./notify";

const WAIT_MS = 10 * 60 * 1000;

type Pending = { request: HelpRequest; settle: (outcome: HelpOutcome) => void };

export type HelpOutcome = "done" | "declined" | "timeout" | "cancelled";

let pending: Pending | null = null;

export const currentHelpRequest = () => pending?.request ?? null;

function finish(outcome: HelpOutcome) {
	const active = pending;
	pending = null;
	broadcast("help:changed", null);
	active?.settle(outcome);
}

export function requestHelp(instruction: string, applicationId?: string): Promise<HelpOutcome> {
	if (pending) finish("cancelled");
	const request: HelpRequest = { id: randomUUID(), instruction, applicationId, askedAt: new Date().toISOString() };
	notify("The agent needs you in the browser", instruction);
	return new Promise((resolve) => {
		const timer = setTimeout(() => pending?.request.id === request.id && finish("timeout"), WAIT_MS);
		pending = {
			request,
			settle: (outcome) => {
				clearTimeout(timer);
				resolve(outcome);
			},
		};
		broadcast("help:changed", request);
	});
}

export function respondToHelp(id: string, done: boolean) {
	if (pending?.request.id === id) finish(done ? "done" : "declined");
}

export function cancelHelp() {
	if (pending) finish("cancelled");
}
