import type { Application, ApplicationStatus, Question } from "./application";

export type Settings = {
	workspaceDir: string;
	autoSubmit: boolean;
	paused: boolean;
	sweepIntervalHours: number;
	model: string;
	onboarded: boolean;
};

export type ClaudeStatus =
	| {
			signedIn: true;
			method: ConnectionStatus["kind"];
			email?: string;
			subscription?: string;
			models: { value: string; label: string }[];
	  }
	| { signedIn: false; reason: string };

export type ConnectionStatus =
	| { kind: "claude-code" }
	| { kind: "api-key"; hint: string }
	| { kind: "custom"; baseUrl: string; model: string; hasToken: boolean };

export type EndpointInput = { baseUrl: string; model: string; token?: string };

/** What an endpoint offers: `models` are ready to use; `cloud` are Ollama cloud models reachable through it. */
export type EndpointModels = { reachable: boolean; models: string[]; cloud: string[] };

export type SetupStatus = {
	claude: ClaudeStatus;
	connection: ConnectionStatus;
	browserInstalled: boolean;
	workspaceDir: string;
	credentialStorage: { encrypted: boolean; backend: string };
};

export type WorkspaceDocument = {
	name: string;
	path: string;
	sizeBytes: number;
	modifiedAt: string;
};

export type CredentialSummary = {
	site: string;
	username: string;
	notes?: string;
	updatedAt: string;
};

export type CredentialInput = {
	site: string;
	username: string;
	password: string;
	notes?: string;
};

export type ActivityItem =
	| { id: string; at: string; kind: "user"; text: string }
	| { id: string; at: string; kind: "assistant"; text: string; subagent: boolean }
	| {
			id: string;
			at: string;
			kind: "tool";
			tool: string;
			summary: string;
			detail?: string;
			state: "running" | "done" | "error";
			subagent: boolean;
	  }
	| { id: string; at: string; kind: "notice"; tone: "info" | "success" | "error"; text: string };

export type AgentState = {
	status: "idle" | "running" | "stopping";
	runLabel?: string;
	queued: number;
	sessionId?: string;
	active: Record<string, string>;
	step?: string;
	paused: boolean;
	nextSweepAt?: string;
};

export type InboxQuestion = Question;

export type HelpRequest = { id: string; instruction: string; applicationId?: string; askedAt: string };

export type UpdateInfo = {
	current: string;
	latest?: string;
	available: boolean;
	url?: string;
	checkedAt?: string;
	error?: string;
};

export type BrowserInstallProgress = { line: string; done: boolean; error?: string };

export type DeskEvents = {
	"applications:changed": undefined;
	"inbox:changed": undefined;
	"agent:state": AgentState;
	"agent:activity": ActivityItem;
	"setup:browser-progress": BrowserInstallProgress;
	"help:changed": HelpRequest | null;
	"update:changed": UpdateInfo;
};

export type DeskApi = {
	settings: {
		get(): Promise<Settings>;
		update(patch: Partial<Settings>): Promise<Settings>;
	};
	setup: {
		status(): Promise<SetupStatus>;
		installBrowser(): Promise<void>;
		chooseWorkspace(): Promise<string | null>;
	};
	documents: {
		list(): Promise<WorkspaceDocument[]>;
		add(paths: string[]): Promise<WorkspaceDocument[]>;
		pick(): Promise<WorkspaceDocument[]>;
		remove(name: string): Promise<WorkspaceDocument[]>;
		pathForFile(file: File): string;
	};
	profile: {
		read(): Promise<string>;
		write(content: string): Promise<void>;
	};
	applications: {
		list(): Promise<Application[]>;
		setStatus(id: string, status: ApplicationStatus): Promise<Application>;
		answer(id: string, questionId: string, answer: string): Promise<Application>;
		remove(id: string): Promise<void>;
		openFolder(id: string): Promise<void>;
		openDocument(id: string, file: string): Promise<void>;
		/** Saves a copy where the user chooses; resolves to the saved path, or null when cancelled. */
		saveDocument(id: string, file: string): Promise<string | null>;
		submit(id: string): Promise<void>;
		addJob(source: string, prepareOnly: boolean): Promise<void>;
	};
	inbox: {
		list(): Promise<InboxQuestion[]>;
		answer(questionId: string, answer: string): Promise<InboxQuestion[]>;
	};
	credentials: {
		list(): Promise<CredentialSummary[]>;
		save(input: CredentialInput): Promise<CredentialSummary[]>;
		remove(site: string): Promise<CredentialSummary[]>;
	};
	agent: {
		state(): Promise<AgentState>;
		activity(): Promise<ActivityItem[]>;
		onboard(): Promise<void>;
		documentsAdded(names: string[]): Promise<void>;
		setPaused(paused: boolean): Promise<void>;
		stop(): Promise<void>;
	};
	help: {
		current(): Promise<HelpRequest | null>;
		respond(id: string, done: boolean): Promise<void>;
	};
	claude: {
		setApiKey(key: string): Promise<SetupStatus>;
		setEndpoint(endpoint: EndpointInput): Promise<SetupStatus>;
		/** Lists the models at an address, or at the saved endpoint when none is given. */
		endpointModels(endpoint?: { baseUrl: string; token?: string }): Promise<EndpointModels>;
		setEndpointModel(model: string): Promise<SetupStatus>;
		clearConnection(): Promise<SetupStatus>;
	};
	updates: {
		status(): Promise<UpdateInfo>;
		check(): Promise<UpdateInfo>;
	};
	shell: {
		openExternal(url: string): Promise<void>;
		open(target: "workspace" | "about-me" | "documents"): Promise<void>;
	};
	on<K extends keyof DeskEvents>(channel: K, listener: (payload: DeskEvents[K]) => void): () => void;
};

type RemoteAreas = Exclude<keyof DeskApi, "on">;

export const DESK_METHODS = {
	settings: ["get", "update"],
	setup: ["status", "installBrowser", "chooseWorkspace"],
	documents: ["list", "add", "pick", "remove"],
	profile: ["read", "write"],
	applications: [
		"list",
		"setStatus",
		"answer",
		"remove",
		"openFolder",
		"openDocument",
		"saveDocument",
		"submit",
		"addJob",
	],
	inbox: ["list", "answer"],
	credentials: ["list", "save", "remove"],
	agent: ["state", "activity", "onboard", "documentsAdded", "setPaused", "stop"],
	help: ["current", "respond"],
	claude: ["setApiKey", "setEndpoint", "endpointModels", "setEndpointModel", "clearConnection"],
	updates: ["status", "check"],
	shell: ["openExternal", "open"],
} as const satisfies { [Area in RemoteAreas]: readonly (keyof DeskApi[Area])[] };

export const DESK_EVENTS = [
	"applications:changed",
	"inbox:changed",
	"agent:state",
	"agent:activity",
	"setup:browser-progress",
	"help:changed",
	"update:changed",
] as const satisfies readonly (keyof DeskEvents)[];
