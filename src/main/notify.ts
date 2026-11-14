import type { Application, ApplicationStatus } from "@shared/application";
import { Notification } from "electron";

const headlines: Partial<Record<ApplicationStatus, string>> = {
	needs_input: "Needs your input",
	ready_to_submit: "Ready to submit",
	manual: "Ready for you to send",
	applied: "Applied",
};

export function notify(title: string, body: string) {
	if (Notification.isSupported()) new Notification({ title, body }).show();
}

export function notifyStatus(application: Application, previous: ApplicationStatus | null) {
	const headline = headlines[application.status];
	if (headline && previous !== null) notify(headline, `${application.title} at ${application.company}`);
}
