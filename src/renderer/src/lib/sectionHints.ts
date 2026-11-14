import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** What belongs under each section of the master resume, shown while the section is empty. */
const HINTS: Record<string, string> = {
	contact: "Phone, email, where you live, and links to your profiles.",
	"what i am looking for": "Roles, seniority, locations, remote or on-site, salary floor, industries to avoid.",
	experience: "A heading for each job, then everything you did there and what came of it.",
	projects: "Things you built or ran outside a job.",
	education: "Degrees, diplomas and courses, with their dates.",
	"certifications and licences": "Professional certificates and licences, with the year.",
	skills: "Tools, methods and languages you can use.",
	achievements: "Awards, recognition and results that belong to no single job.",
	languages: "Each language and how well you speak it.",
	referees: "People who will vouch for you: name, title, employer, phone and email.",
	"other facts":
		"Things that matter to some jobs and not others: a driving licence, willingness to travel or relocate, citizenship, volunteering, interests.",
	"do not have": "Things a job asked for that you do not have, so they are never claimed and never asked again.",
	"standard answers": "Salary expectation, notice period, work authorisation.",
	"writing voice": "How you write: formal or plain, brief or detailed.",
	"never do": "Anything the agent must not do or say for you.",
};

/**
 * Shows a hint under every section heading that has nothing beneath it yet. The hint is not part of
 * the document: nothing is saved for it, and clicking it starts a line to type on.
 */
export const SectionHints = Extension.create({
	name: "sectionHints",

	addProseMirrorPlugins() {
		const { editor } = this;
		return [
			new Plugin({
				key: new PluginKey("sectionHints"),
				props: {
					decorations({ doc }) {
						const decorations: Decoration[] = [];
						// A section runs until the next section heading. A job's heading inside it is content.
						const endsSection = (index: number) => {
							if (index >= doc.childCount) return true;
							const node = doc.child(index);
							return node.type.name === "heading" && node.attrs.level <= 2;
						};

						doc.forEach((node, offset, index) => {
							if (node.type.name !== "heading" || node.attrs.level !== 2) return;
							const hint = HINTS[node.textContent.trim().toLowerCase()];
							if (!hint) return;
							const after = offset + node.nodeSize;

							if (endsSection(index + 1)) {
								// Nothing under the heading: the hint stands where the first line will go.
								const line = () => {
									const element = document.createElement("p");
									element.className = "section-hint";
									element.textContent = hint;
									element.contentEditable = "false";
									element.addEventListener("mousedown", (event) => {
										event.preventDefault();
										editor
											.chain()
											.insertContentAt(after, { type: "paragraph" })
											.setTextSelection(after + 1)
											.focus()
											.run();
									});
									return element;
								};
								decorations.push(Decoration.widget(after, line, { side: -1, key: `hint:${hint}` }));
								return;
							}

							// An empty line under the heading: the hint sits on it until something is typed.
							const next = doc.child(index + 1);
							if (next.type.name === "paragraph" && next.content.size === 0 && endsSection(index + 2)) {
								decorations.push(
									Decoration.node(after, after + next.nodeSize, { class: "section-empty", "data-hint": hint }),
								);
							}
						});
						return DecorationSet.create(doc, decorations);
					},
				},
			}),
		];
	},
});
