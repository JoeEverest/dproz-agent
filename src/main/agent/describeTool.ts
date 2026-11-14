import path from "node:path";

type Input = Record<string, unknown>;

const text = (value: unknown, limit = 90) => {
	const flat = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

const fileName = (value: unknown) => path.basename(String(value ?? ""));

function host(value: unknown) {
	try {
		return new URL(String(value)).hostname.replace(/^www\./, "");
	} catch {
		return text(value, 60);
	}
}

const delegationVerbs: Record<string, string> = {
	"application-writer": "Preparing",
	"application-judge": "Judging",
	"application-sender": "Sending",
};

function delegation(input: Input) {
	const verb = delegationVerbs[String(input.subagent_type)] ?? "Working on";
	return `${verb}: ${text(input.description ?? "an application", 70)}`;
}

const describers: Record<string, (input: Input) => string> = {
	Read: (input) => `Read ${fileName(input.file_path)}`,
	Write: (input) => `Write ${fileName(input.file_path)}`,
	Edit: (input) => `Edit ${fileName(input.file_path)}`,
	Glob: (input) => `Look for files ${text(input.pattern, 50)}`,
	Grep: (input) => `Search files for "${text(input.pattern, 50)}"`,
	Bash: (input) => `Run ${text(input.description ?? input.command, 80)}`,
	WebSearch: (input) => `Search the web for "${text(input.query, 70)}"`,
	WebFetch: (input) => `Read ${host(input.url)}`,
	Agent: delegation,
	Task: delegation,
	TodoWrite: () => "Update the plan",
	search_jobs: (input) => `Search Dproz${input.query ? ` for "${text(input.query, 50)}"` : ""}`,
	get_job: () => "Read the job on Dproz",
	list_categories: () => "List Dproz categories",
	list_applications: () => "Check the board",
	get_application: (input) => `Open card ${text(input.id, 50)}`,
	save_application: (input) =>
		input.id
			? `Update card ${text(input.id, 50)}${input.status ? ` → ${text(input.status)}` : ""}`
			: `Add card: ${text(input.title, 50)} at ${text(input.company, 40)}`,
	ask_user: (input) => {
		const first = (input.questions as { question?: string; item?: string }[] | undefined)?.[0];
		return `Ask you: ${text(first?.question ?? (first?.item ? `Do you have this: ${first.item}?` : ""), 80)}`;
	},
	get_answers: () => "Check for your answers",
	get_credentials: (input) => `Get the login for ${host(input.site)}`,
	save_credentials: (input) => `Save the login for ${host(input.site)}`,
	request_browser_help: (input) => `Waiting for you: ${text(input.instruction, 80)}`,
	render_pdf: (input) => `Render ${fileName(input.pdf ?? input.html)}`,
	render_resume: (input) => `Write ${fileName(input.pdf)}`,
	save_master_resume: () => "Update your master resume",
	browser_navigate: (input) => `Open ${host(input.url)}`,
	browser_navigate_back: () => "Go back",
	browser_snapshot: () => "Read the page",
	browser_take_screenshot: () => "Take a screenshot",
	browser_click: (input) => `Click ${text(input.element ?? "an element", 60)}`,
	browser_type: (input) => `Type into ${text(input.element ?? "a field", 60)}`,
	browser_fill_form: (input) => `Fill ${(input.fields as unknown[] | undefined)?.length ?? "some"} form fields`,
	browser_select_option: (input) => `Choose an option in ${text(input.element ?? "a list", 60)}`,
	browser_file_upload: (input) =>
		`Upload ${((input.paths as string[] | undefined) ?? []).map(fileName).join(", ") || "a file"}`,
	browser_press_key: (input) => `Press ${text(input.key, 20)}`,
	browser_wait_for: () => "Wait for the page",
	browser_tabs: () => "Manage browser tabs",
	browser_close: () => "Close the browser",
};

export function describeTool(name: string, input: Input) {
	const shortName = name.replace(/^mcp__.+?__/, "");
	const describe = describers[name] ?? describers[shortName];
	return describe ? describe(input ?? {}) : shortName.replaceAll("_", " ");
}
