import { Markdown } from "@tiptap/markdown";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Check, List, Redo2, RefreshCw, Undo2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useAgentState } from "../lib/agent";
import { useResource } from "../lib/hooks";
import { SectionHints } from "../lib/sectionHints";
import { PageHeader } from "./PageHeader";
import { Button, IconButton, Notice, Picker } from "./ui";

const NAME = "Your master resume";

type Block = "title" | "section" | "item" | "text";

const BLOCKS: { value: Block; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "section", label: "Section" },
	{ value: "item", label: "Job or item" },
	{ value: "title", label: "Title" },
];
const LEVELS = { title: 1, section: 2, item: 3 } as const;

type ToolProps = { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode };

function Tool({ label, active, disabled, onClick, children }: ToolProps) {
	return (
		<IconButton
			label={label}
			aria-pressed={active}
			disabled={disabled}
			// Keep the selection in the text while a tool is pressed.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className="aria-pressed:bg-accent-soft aria-pressed:text-accent-ink disabled:opacity-40"
		>
			{children}
		</IconButton>
	);
}

function Toolbar({ editor }: { editor: Editor }) {
	const state = useEditorState({
		editor,
		// Until the page has the cursor there is no line for the tools to describe.
		selector: ({ editor: current }): { block: Block; list: boolean; bold: boolean; undo: boolean; redo: boolean } => ({
			block: !current.isFocused
				? "text"
				: current.isActive("heading", { level: 1 })
					? "title"
					: current.isActive("heading", { level: 2 })
						? "section"
						: current.isActive("heading", { level: 3 })
							? "item"
							: "text",
			list: current.isFocused && current.isActive("bulletList"),
			bold: current.isFocused && current.isActive("bold"),
			undo: current.can().undo(),
			redo: current.can().redo(),
		}),
	});
	const run = () => editor.chain().focus();
	const setBlock = (block: Block) =>
		block === "text" ? run().setParagraph().run() : run().setHeading({ level: LEVELS[block] }).run();
	const size = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;

	return (
		<div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
			<Picker
				label="Kind of line"
				className="mr-1.5 w-[124px]"
				value={state.block}
				onChange={setBlock}
				options={BLOCKS}
			/>
			<Tool label="Bullet list" active={state.list} onClick={() => run().toggleBulletList().run()}>
				<List {...size} />
			</Tool>
			<Tool label="Bold" active={state.bold} onClick={() => run().toggleBold().run()}>
				<Bold {...size} />
			</Tool>
			<span className="mx-1.5 h-4 w-px bg-line" aria-hidden />
			<Tool label="Undo" disabled={!state.undo} onClick={() => run().undo().run()}>
				<Undo2 {...size} />
			</Tool>
			<Tool label="Redo" disabled={!state.redo} onClick={() => run().redo().run()}>
				<Redo2 {...size} />
			</Tool>
		</div>
	);
}

/**
 * The user's master resume, about-me.md, as a page they edit in place. It is the source of truth about
 * them: the agent writes every application from it and works their answers into it. `aside` is the bar
 * beside the page.
 */
export function MasterRecord({ aside }: { aside: ReactNode }) {
	const profile = useResource(() => window.desk.profile.read(), ["agent:state"]);
	const agent = useAgentState();
	// The text on disk that the page's content came from. A save is refused if the file has moved on.
	const base = useRef<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [theirs, setTheirs] = useState<string | null>(null);

	const editor = useEditor({
		extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Markdown, SectionHints],
		content: "",
		contentType: "markdown",
		editorProps: { attributes: { class: "master-record", "aria-label": NAME, role: "textbox" } },
		onUpdate: () => {
			setDirty(true);
			setSaved(false);
		},
	});

	const show = (text: string) => {
		editor?.commands.setContent(text, { contentType: "markdown", emitUpdate: false });
		base.current = text;
		setDirty(false);
	};

	// Follow the file while the user has nothing unsaved: the agent adds to it as it learns.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a change on disk or a new editor should reload
	useEffect(() => {
		if (editor && profile.data !== undefined && !dirty && profile.data !== base.current) show(profile.data);
	}, [editor, profile.data]);

	const save = async (force = false) => {
		if (!editor) return;
		setSaving(true);
		try {
			const text = editor.getMarkdown();
			const result = await window.desk.profile.write(text, force ? undefined : (base.current ?? undefined));
			if (!result.saved) return setTheirs(result.current);
			base.current = text;
			profile.setData(text);
			setDirty(false);
			setTheirs(null);
			setSaved(true);
		} finally {
			setSaving(false);
		}
	};

	const discard = () => {
		show(theirs ?? profile.data ?? "");
		setTheirs(null);
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			if (dirty && !saving && theirs === null) void save();
		}
	};

	return (
		<>
			<PageHeader title="Profile settings">
				{saved && !dirty && (
					<span role="status" className="flex items-center gap-1.5 text-xs text-ink-3">
						<Check size={13} strokeWidth={2} className="text-sent-ink" aria-hidden />
						{agent.paused ? "Saved" : "Saved. The agent works from this from now on"}
					</span>
				)}
				{dirty && theirs === null && (
					<>
						<span className="text-xs text-ink-3">Unsaved changes</span>
						<Button size="sm" tone="quiet" disabled={saving} onClick={discard}>
							Discard
						</Button>
						<Button size="sm" tone="primary" disabled={saving} onClick={() => void save()}>
							{saving ? "Saving" : "Save"}
						</Button>
					</>
				)}
			</PageHeader>

			<div className="relative flex min-h-0 flex-1">
				<section aria-label={NAME} onKeyDown={onKeyDown} className="flex min-w-0 flex-1 flex-col">
					<div className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
						{editor && <Toolbar editor={editor} />}
						<p className="min-w-0 truncate text-xs text-ink-3">
							The agent writes every application from this page and adds your answers to it.
						</p>
					</div>
					<div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain">
						<div className="mx-auto w-full max-w-[720px] px-10 pt-9 pb-24">
							{theirs !== null && (
								<div className="mb-6">
									<Notice tone="attention" icon={<RefreshCw size={15} strokeWidth={1.75} aria-hidden />}>
										<p>The agent added to this while you were editing, so your changes are not saved yet.</p>
										<div className="mt-2 flex gap-2">
											<Button size="sm" tone="primary" disabled={saving} onClick={() => void save(true)}>
												Save mine over it
											</Button>
											<Button size="sm" disabled={saving} onClick={discard}>
												Drop mine and show the agent's
											</Button>
										</div>
									</Notice>
								</div>
							)}
							<EditorContent editor={editor} />
						</div>
					</div>
				</section>
				{aside}
			</div>
		</>
	);
}
