import { describe, expect, it } from "vitest";
import { renderResume } from "../../src/main/resume/render";
import { reviewResume } from "../../src/main/resume/review";
import { RESUME_TEMPLATE_IDS, type Resume, resumeSchema } from "../../src/shared/resume";

const resume: Resume = {
	contact: {
		firstName: "Rehema",
		lastName: "Kisanga",
		title: "Accountant",
		email: "rehema@example.com",
		phone: "+255 700 000 000",
		location: { city: "Arusha", country: "Tanzania" },
	},
	summary: "Accountant with 6 years in manufacturing finance. Cut month-end close from 9 days to 4 at Kilele Foods.",
	skills: "- Accounting: IFRS, Cost accounting, Bank reconciliation\n- Tools: Excel, SQL, Tally",
	workExperience: [
		{
			jobTitle: "Accountant",
			employer: "Kilele Foods <Ltd>",
			startDate: "Jan 2020",
			current: true,
			highlights:
				"Dairy processor with 340 employees\n- Reduced month-end close from 9 days to 4 by automating bank reconciliations\n- Ran payroll for 340 employees without a late payment",
		},
	],
	education: [{ schoolName: "Institute of Accountancy Arusha", educationLevel: "BSc.", fieldOfStudy: "Accounting" }],
	personalLinks: [{ type: "LinkedIn", value: "https://www.linkedin.com/in/rehema/" }],
	references: [{ name: "Amina Mushi", designation: "Finance Manager", workPlace: "Kilele Foods" }],
};

const aboutMe = "Kilele Foods has 340 employees. Month-end close went from 9 days to 4. 6 years of experience.";

describe("renderResume", () => {
	it("prints every layout with the same content", () => {
		for (const template of RESUME_TEMPLATE_IDS) {
			const html = renderResume(resume, { template });
			expect(html).toContain("Rehema Kisanga");
			expect(html).toContain("<li>Ran payroll for 340 employees without a late payment</li>");
			expect(html).toContain("Jan 2020 – Present");
			expect(html).toContain("BSc., Accounting");
			expect(html).toContain("linkedin.com/in/rehema");
			expect(html).not.toContain("https://www.linkedin.com");
			expect(html).toContain("Referees");
			expect(html).toContain("@page { size: A4;");
			// Nothing in the text can become markup, and nothing is fetched from the network.
			expect(html).toContain("Kilele Foods &lt;Ltd&gt;");
			expect(html).not.toMatch(/<link|<script|url\(/);
		}
	});

	it("sets labelled skills as rows and a plain list as one run of text", () => {
		const labelled = renderResume(resume, { template: "modern" });
		expect(labelled).toContain('<span class="group">Accounting</span>');
		const plain = renderResume({ ...resume, skills: "- Excel\n- SQL\n- Tally" }, { template: "modern" });
		expect(plain).toContain("<p>Excel, SQL, Tally</p>");
	});

	it("puts sections in the order asked for and leaves out empty ones", () => {
		const html = renderResume(resume, { template: "classic", sectionOrder: ["education", "experience"] });
		expect(html.indexOf("<h2>Education</h2>")).toBeLessThan(html.indexOf("<h2>Experience</h2>"));
		expect(html.indexOf("<h2>Experience</h2>")).toBeLessThan(html.indexOf("<h2>Summary</h2>"));
		expect(html).not.toContain("<h2>Certifications</h2>");
	});

	it("accepts a master resume as the Dproz AI service stores it, nulls and all", () => {
		const fromService = resumeSchema.parse({
			contact: {
				firstName: "A",
				middleName: null,
				lastName: "B",
				title: null,
				email: null,
				phone: null,
				location: null,
			},
			summary: null,
			skills: "- Sales",
			workExperience: [
				{
					jobTitle: "Sales Officer",
					employer: "X",
					location: null,
					startDate: "2021",
					endDate: null,
					current: null,
					highlights: "- Sold",
					relevantSkills: "- CRM\n- Negotiation",
				},
			],
			education: [],
			certifications: null,
			languages: [{ language: "Swahili", proficiency: null }],
			accomplishments: null,
			affiliations: null,
			personalLinks: [],
			references: [],
			additionalInfo: null,
			customSections: [{ title: "Projects", content: "**Stock app**\n- Built it" }],
		});
		const html = renderResume(fromService, { template: "executive" });
		expect(html).toContain("Core technologies:</span> CRM, Negotiation");
		expect(html).toContain("<p><strong>Stock app</strong></p><ul><li>Built it</li></ul>");
	});
});

describe("reviewResume", () => {
	it("has nothing to say about a resume that follows the rules", () => {
		expect(reviewResume(resume, { aboutMe })).toEqual([]);
	});

	const withBullets = (highlights: string): Resume => ({
		...resume,
		workExperience: [{ jobTitle: "Accountant", employer: "Kilele Foods", highlights }],
	});
	const notesFor = (highlights: string) => reviewResume(withBullets(highlights), { aboutMe }).join("\n");

	it("catches the first person, duties, repeated verbs and bullets that run on", () => {
		expect(notesFor("- I built the costing model for 340 staff")).toContain("first person");
		expect(notesFor("- Responsible for payroll for 340 employees")).toContain("names a duty");
		expect(notesFor("- Built a model for 340 staff\n- Built a report")).toContain('2 bullets open with "built"');
		expect(notesFor(`- Built ${"a very long description of the work ".repeat(8)}`)).toContain("runs past two lines");
		expect(notesFor("- Built the model. It was used by 340 staff")).toContain("more than one sentence");
		expect(notesFor("- Built a model\n- Wrote a report\n- Trained staff")).toContain("no bullet has a number");
	});

	it("does not mistake a grade or a phase for the first person", () => {
		expect(notesFor("- Completed CPA Level I and trained 340 staff")).not.toContain("first person");
	});

	it("keeps the summary in the first person when the user's own resume is", () => {
		const mine = { ...resume, summary: "I am an accountant with 6 years in manufacturing finance." };
		expect(reviewResume(mine, { aboutMe }).join("\n")).toContain("first person");
		expect(reviewResume(mine, { aboutMe, master: mine }).join("\n")).not.toContain("first person");
	});

	it("catches a figure the user never gave", () => {
		const notes = notesFor("- Cut costs by 35% across 340 staff");
		expect(notes).toContain("gives 35");
		expect(notes).not.toContain("gives 340");
	});

	it("catches the posting's thresholds, wording, title and employer", () => {
		const job = "We need someone with strong knowledge of statutory tax returns and audits. At least 5 years.";
		const tailored: Resume = {
			...resume,
			contact: { ...resume.contact, title: "Finance Controller" },
			summary: "Accountant with at least 5 years of experience, ready to join Twiga Cement.",
			skills:
				"- Accounting: IFRS\n- Strong knowledge of statutory tax returns and audits\n- Tanzanian citizen\n- Teamwork",
		};
		const notes = reviewResume(tailored, {
			aboutMe,
			master: resume,
			job,
			company: "Twiga Cement",
			jobTitle: "Finance Controller",
		}).join("\n");
		expect(notes).toContain('"at least 5 years" is how a posting states a requirement');
		expect(notes).toContain("names the employer being applied to (Twiga Cement)");
		expect(notes).toContain('"Finance Controller" is the title of the job');
		expect(notes).toContain("is the posting's wording");
		expect(notes).toContain('"Tanzanian citizen" is a condition of eligibility');
		expect(notes).toContain('"Teamwork" is a personal quality');
		expect(notes).toContain("is requirement text, not the name of a skill");
		// Skills the user already listed are theirs to keep.
		expect(notes).not.toContain('"IFRS"');
	});
});
