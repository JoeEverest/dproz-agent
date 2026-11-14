import type { Application, ApplicationStatus, Question, QuestionReply } from "./application";

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

/** A web page the user gave as a source about themselves. The agent reads it; nothing is downloaded. */
export type SourceLink = { url: string; addedAt: string };

/** What adding a link did: a link to a file becomes a document, a link to a page is kept as a link. */
export type LinkAdded = {
	documents: WorkspaceDocument[];
	links: SourceLink[];
	added?: { kind: "document"; name: string } | { kind: "link"; url: string };
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
	/** The user has the agent's browser open to sign in, so the agent is waiting for it. */
	browserOpen: boolean;
	nextSweepAt?: string;
};

export type InboxQuestion = Question;

/**
 * What became of the user's edit to their master resume. It is not saved when the agent changed the
 * file while they were editing: `current` is then the agent's version, for them to choose between.
 */
export type ProfileSaved = { saved: true; previous: string } | { saved: false; current: string };

export type HelpRequest = { id: string; instruction: string; applicationId?: string; askedAt: string };

export type UpdateInfo = {
	current: string;
	latest?: string;
	available: boolean;
	/** Where to download the new version by hand: the fallback when it cannot be installed in place. */
	url?: string;
	checkedAt?: string;
	error?: string;
	/** Whether this copy can download the new version itself and install it on restart. */
	inPlace: boolean;
	/** Why it cannot, when that is something the user can fix. */
	blocked?: string;
	stage: "idle" | "downloading" | "ready" | "failed";
	/** How much of the download has arrived, from 0 to 1. */
	progress?: number;
	/** What went wrong with the download or the install. */
	problem?: string;
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
		/** Saves a copy where the user chooses. Returns where it went, or null if they cancelled. */
		save(name: string): Promise<string | null>;
		links(): Promise<SourceLink[]>;
		addLink(link: string): Promise<LinkAdded>;
		removeLink(url: string): Promise<SourceLink[]>;
		pathForFile(file: File): string;
	};
	profile: {
		read(): Promise<string>;
		/** `base` is the text the edit started from. See ProfileSaved. */
		write(content: string, base?: string): Promise<ProfileSaved>;
	};
	applications: {
		list(): Promise<Application[]>;
		setStatus(id: string, status: ApplicationStatus): Promise<Application>;
		answer(id: string, questionId: string, reply: QuestionReply): Promise<Application>;
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
		answer(questionId: string, reply: QuestionReply): Promise<InboxQuestion[]>;
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
		linksAdded(urls: string[]): Promise<void>;
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
	browser: {
		/** Opens the agent's own browser for the user to sign in to sites. The agent waits until it is closed. */
		open(url?: string): Promise<{ ok: true } | { ok: false; reason: string }>;
		close(): Promise<void>;
	};
	updates: {
		status(): Promise<UpdateInfo>;
		check(): Promise<UpdateInfo>;
		download(): Promise<UpdateInfo>;
		install(): Promise<UpdateInfo>;
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
	documents: ["list", "add", "pick", "remove", "save", "links", "addLink", "removeLink"],
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
	agent: ["state", "activity", "onboard", "documentsAdded", "linksAdded", "setPaused", "stop"],
	help: ["current", "respond"],
	claude: ["setApiKey", "setEndpoint", "endpointModels", "setEndpointModel", "clearConnection"],
	browser: ["open", "close"],
	updates: ["status", "check", "download", "install"],
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
