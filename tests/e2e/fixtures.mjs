import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const resumeHtml = `<html><body style="font-family:Georgia,serif;font-size:11pt;margin:40px;line-height:1.4">
<h1 style="margin-bottom:0">Rehema S. Kisanga</h1>
<p>Arusha, Tanzania · +255 700 000 000 · rehema.kisanga@example.com</p>
<h2>Summary</h2><p>Accountant with five years of experience in food manufacturing and audit. Tanzanian citizen.</p>
<h2>Experience</h2>
<h3>Assistant Accountant — Meru Dairies Ltd, Arusha (March 2022 – present)</h3>
<ul><li>Run month-end close for two plants; cut close from 9 working days to 5.</li><li>Reconcile 14 bank accounts monthly and manage a creditors ledger of about 220 suppliers.</li><li>Prepare VAT, PAYE and SDL returns for TRA; no penalties in three years.</li><li>Introduced weekly stock counts with the stores team, reducing inventory variance from 4.1% to 1.3%.</li><li>Built the monthly management accounts pack in Excel and Sage 300.</li></ul>
<h3>Audit Associate — Tembo & Partners (Certified Public Accountants), Dar es Salaam (January 2020 – February 2022)</h3>
<ul><li>Audited manufacturing and NGO clients with revenue up to TZS 18 billion.</li><li>Led fieldwork for inventory and payables on six engagements.</li></ul>
<h2>Education</h2>
<p>Bachelor of Commerce in Accounting, University of Dar es Salaam, 2019 (Upper Second)</p>
<p>CPA(T): Intermediate level passed (NBAA, 2023); final level in progress</p>
<h2>Skills</h2><p>Excel (pivot tables, Power Query), Sage 300, QuickBooks, Tally. English and Swahili, fluent.</p>
</body></html>`;

const certificateHtml = `<html><body style="font-family:serif;margin:60px;text-align:center">
<h2>NATIONAL BOARD OF ACCOUNTANTS AND AUDITORS (TEST DOCUMENT)</h2><p>This is to certify that</p><h1>REHEMA S. KISANGA</h1>
<p>passed the <strong>Intermediate Level</strong> examinations of the Certified Public Accountant (Tanzania) programme in the November 2023 session.</p>
<p>Candidate number: TEST-000123</p></body></html>`;

const coverLetterSample = `Sample cover letter (sent to a previous employer, 2022)

Dear Hiring Manager,

I am writing to apply for the Assistant Accountant role at Meru Dairies. At Tembo & Partners I spent two years auditing manufacturers, and the part I enjoyed most was finding out why stock and cash did not match the books, then fixing the process so it would not happen again. I would like to do that from the inside.

I work carefully and I say plainly when something is wrong. I would welcome the chance to talk.

Yours sincerely,
Rehema Kisanga
`;

export async function writePersonaDocuments(directory) {
	await fs.mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage();
	const resume = path.join(directory, "Rehema Kisanga CV.pdf");
	const certificate = path.join(directory, "CPA Intermediate certificate.pdf");
	await page.setContent(resumeHtml);
	await page.pdf({ path: resume, format: "A4" });
	await page.setContent(certificateHtml);
	await page.pdf({ path: certificate, format: "A4" });
	await browser.close();
	const coverLetter = path.join(directory, "Old cover letter.txt");
	await fs.writeFile(coverLetter, coverLetterSample);
	return [resume, certificate, coverLetter];
}

const answers = [
	[/salary|pay|compensation|remuneration/i, "TZS 2,800,000 gross per month, negotiable."],
	[/licen[cs]e|driv/i, "Yes, I hold a valid class B driving licence, valid until 2029."],
	[/relocat/i, "I already live in Arusha and I am happy to stay here. Open to Dar es Salaam for the right role."],
	[/notice|start|availab/i, "One month's notice. I can start 30 days after an offer."],
	[/contact.*(now|offer)|after an offer/i, "Only after an offer. Do not contact Meru Dairies before then."],
	[
		/second referee|different person|another referee/i,
		"Ms. Zuhura Mbwana, Audit Manager at Tembo & Partners, +255 700 000 002, zuhura.mbwana@example.com. She supervised me for two years.",
	],
	[
		/refere/i,
		"Dr. Amani Laizer, Finance Manager at Meru Dairies, +255 700 000 001, amani.laizer@example.com (my current manager), and Ms. Zuhura Mbwana, Audit Manager at Tembo & Partners, +255 700 000 002, zuhura.mbwana@example.com (my former supervisor). Contact them only after an offer.",
	],
	[
		/role|position|looking for|target|kind of (job|work)/i,
		"Finance Officer, Accountant or Senior Accountant roles in manufacturing or FMCG.",
	],
	[/location|where|remote|city|region/i, "Arusha first, Dar es Salaam second. On-site is fine."],
	[/authori[sz]|citizen|permit|nationality/i, "I am a Tanzanian citizen, so I need no work permit."],
	[/linkedin|portfolio|website/i, "I do not have a LinkedIn profile or website."],
];

export const answerFor = (question) =>
	answers.find(([pattern]) => pattern.test(question))?.[1] ??
	"No strong preference. Use your judgement and what my CV says.";
