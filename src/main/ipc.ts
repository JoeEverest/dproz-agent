import fs from "node:fs/promises";
import path from "node:path";
import type { DeskApi, SetupStatus } from "@shared/ipc";
import { normaliseLink } from "@shared/links";
import { app, dialog, ipcMain, shell } from "electron";
import { agent } from "./agent/manager";
import {
	answerApplicationQuestion,
	answerInboxQuestion,
	applicationFolder,
	listApplications,
	listInbox,
	patchApplication,
	removeApplication,
	watchApplications,
} from "./applications";
import { claudeStatus } from "./claude";
import {
	changeEndpointModel,
	clearConnection,
	connectionStatus,
	endpointModels,
	saveApiKey,
	saveEndpoint,
} from "./connection";
import { listCredentials, removeCredential, saveCredential, storageBackend } from "./credentials";
import { isInside } from "./files";
import { currentHelpRequest, respondToHelp } from "./help";
import { addLink, listLinks, removeLink } from "./links";
import { installBrowser, isBrowserInstalled } from "./runtime";
import { getSettings, updateSettings } from "./settings";
import { checkForUpdate, downloadUpdate, installUpdate, updateStatus } from "./updates";
import { closeUserBrowser, openUserBrowser } from "./userBrowser";
import { addDocuments, listDocuments, readAboutMe, removeDocument, workspacePaths, writeAboutMe } from "./workspace";

type Remote<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Awaited<R> : never;
};

type Handlers = {
	[Area in Exclude<keyof DeskApi, "on">]: Remote<Omit<DeskApi[Area], "pathForFile">>;
};

async function setupStatus(): Promise<SetupStatus> {
	const [claude, browserInstalled, settings] = await Promise.all([claudeStatus(), isBrowserInstalled(), getSettings()]);
	return {
		claude,
		connection: connectionStatus(),
		browserInstalled,
		workspaceDir: settings.workspaceDir,
		credentialStorage: storageBackend(),
	};
}

const handlers: Handlers = {
	settings: {
		get: getSettings,
		update: async (patch) => {
			const settings = await updateSettings(patch);
			await agent.syncSettings();
			if (patch.workspaceDir) await watchApplications();
			return settings;
		},
	},
	setup: {
		status: setupStatus,
		installBrowser,
		chooseWorkspace: async () => {
			const { workspaceDir } = await getSettings();
			const result = await dialog.showOpenDialog({
				title: "Choose the agent's workspace folder",
				defaultPath: workspaceDir,
				properties: ["openDirectory", "createDirectory"],
			});
			if (result.canceled || !result.filePaths[0]) return null;
			await updateSettings({ workspaceDir: result.filePaths[0] });
			await watchApplications();
			return result.filePaths[0];
		},
	},
	documents: {
		list: listDocuments,
		add: addDocuments,
		pick: async () => {
			const result = await dialog.showOpenDialog({
				title: "Add documents",
				properties: ["openFile", "multiSelections"],
			});
			return result.canceled ? listDocuments() : addDocuments(result.filePaths);
		},
		remove: removeDocument,
		save: async (name) => {
			const { documents } = await workspacePaths();
			const source = path.resolve(documents, name);
			return isInside(documents, source) && source !== documents ? saveCopy(source) : null;
		},
		links: listLinks,
		addLink,
		removeLink,
	},
	profile: {
		read: readAboutMe,
		write: async (content, base) => {
			const result = await writeAboutMe(content, base);
			if (result.saved) agent.profileEdited(result.previous, content);
			return result;
		},
	},
	applications: {
		list: listApplications,
		setStatus: (id, status) => patchApplication(id, { status }),
		answer: async (id, questionId, answer) => {
			const application = await answerApplicationQuestion(id, questionId, answer);
			agent.answersArrived();
			return application;
		},
		remove: removeApplication,
		openFolder: async (id) => {
			await shell.openPath(await applicationFolder(id));
		},
		openDocument: async (id, file) => {
			const folder = await applicationFolder(id);
			const target = path.resolve(folder, file);
			if (isInside(folder, target)) await shell.openPath(target);
		},
		saveDocument: async (id, file) => {
			const folder = await applicationFolder(id);
			const source = path.resolve(folder, file);
			return isInside(folder, source) ? saveCopy(source) : null;
		},
		submit: (id) => agent.submit(id),
		addJob: (source, prepareOnly) => agent.addJob(source, prepareOnly),
	},
	inbox: {
		list: listInbox,
		answer: async (questionId, answer) => {
			const inbox = await answerInboxQuestion(questionId, answer);
			agent.answersArrived();
			return inbox;
		},
	},
	credentials: { list: listCredentials, save: saveCredential, remove: removeCredential },
	agent: {
		state: () => agent.state(),
		activity: () => agent.recentActivity(),
		onboard: () => agent.onboard(),
		documentsAdded: (names) => agent.documentsAdded(names),
		linksAdded: (urls) => agent.linksAdded(urls),
		setPaused: (paused) => agent.setPaused(paused),
		stop: () => agent.stop(),
	},
	help: { current: currentHelpRequest, respond: respondToHelp },
	claude: {
		setApiKey: async (key) => {
			await saveApiKey(key);
			return setupStatus();
		},
		setEndpoint: async (endpoint) => {
			await saveEndpoint(endpoint);
			return setupStatus();
		},
		endpointModels,
		setEndpointModel: async (model) => {
			await changeEndpointModel(model);
			return setupStatus();
		},
		clearConnection: async () => {
			await clearConnection();
			return setupStatus();
		},
	},
	browser: {
		open: (url) => openUserBrowser((typeof url === "string" && normaliseLink(url)) || undefined),
		close: async () => closeUserBrowser(),
	},
	updates: { status: updateStatus, check: checkForUpdate, download: downloadUpdate, install: installUpdate },
	shell: {
		openExternal: async (url) => {
			if (/^(https?|mailto):/i.test(url)) await shell.openExternal(url);
		},
		open: async (target) => {
			const paths = await workspacePaths();
			const locations = { workspace: paths.root, "about-me": paths.aboutMe, documents: paths.documents };
			await shell.openPath(locations[target]);
		},
	},
};

/** Copies a file to where the user chooses. Tests name a folder instead of driving the save dialog. */
async function saveCopy(source: string) {
	const suggested = path.join(process.env.DPROZ_AGENT_SAVE_TO ?? app.getPath("downloads"), path.basename(source));
	const chosen = process.env.DPROZ_AGENT_SAVE_TO
		? suggested
		: (await dialog.showSaveDialog({ title: "Save a copy", defaultPath: suggested })).filePath;
	if (!chosen) return null;
	await fs.copyFile(source, chosen);
	return chosen;
}

export function registerIpc() {
	for (const [area, methods] of Object.entries(handlers)) {
		for (const [method, handler] of Object.entries(methods)) {
			ipcMain.handle(`${area}:${method}`, (_event, ...args: unknown[]) =>
				(handler as (...parameters: unknown[]) => unknown)(...args),
			);
		}
	}
}
