import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";

const page = (
	title,
	body,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Kilele Foods Careers</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.5;color:#1b1b1b}
label{display:block;margin:14px 0 4px;font-weight:600} input,select,textarea{font:inherit;padding:8px;width:100%;box-sizing:border-box}
input[type=radio]{width:auto} fieldset{margin:24px 0;padding:16px;border:1px solid #ccc} button,.button{font:inherit;padding:10px 18px;background:#14532d;color:#fff;border:0;border-radius:6px;cursor:pointer;text-decoration:none;display:inline-block}
.error{color:#b91c1c;font-weight:600} dt{font-weight:600;margin-top:10px} header{border-bottom:1px solid #ddd;margin-bottom:24px}
</style></head><body><header><p><strong>Kilele Foods Ltd</strong> · Careers</p></header>${body}</body></html>`;

const jobPage = page(
	"Finance Officer",
	`<h1>Finance Officer</h1>
<p><strong>Location:</strong> Arusha, Tanzania · <strong>Type:</strong> Full-time · <strong>Closes:</strong> 30 December 2026</p>
<p>Kilele Foods Ltd is a fast-growing food processing company supplying retailers across northern Tanzania. We are hiring a Finance Officer to own month-end close, supplier payments and management reporting for our Arusha plant.</p>
<h2>What you will do</h2>
<ul><li>Run month-end close and bank reconciliations for the plant within five working days</li><li>Process supplier payments and manage the creditors ledger</li><li>Prepare monthly management accounts and variance analysis for the Finance Manager</li><li>Support the annual external audit and TRA filings (VAT, PAYE, SDL)</li><li>Improve controls around inventory and cash handling</li></ul>
<h2>What you need</h2>
<ul><li>Bachelor's degree in Accounting, Finance or a related field</li><li>At least three years of accounting experience, ideally in manufacturing or FMCG</li><li>CPA(T) or progress towards it</li><li>Strong Excel; experience with QuickBooks, Sage or a similar system</li><li>A valid class B driving licence, because the role visits depots weekly</li></ul>
<p><a class="button" href="/apply">Apply for this job</a></p>`,
);

const accountPage = (error = "") =>
	page(
		"Create your candidate account",
		`<h1>Create your candidate account</h1><p>You need an account to apply. Already registered? <a href="/account/sign-in">Sign in</a>.</p>
${error ? `<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/account/create">
<label for="email">Email address</label><input id="email" name="email" type="email" required>
<label for="password">Password</label><input id="password" name="password" type="password" required minlength="10">
<label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" required>
<p><button type="submit">Create account</button></p></form>`,
	);

const signInPage = (error = "") =>
	page(
		"Sign in",
		`<h1>Sign in</h1>${error ? `<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/account/sign-in">
<label for="email">Email address</label><input id="email" name="email" type="email" required>
<label for="password">Password</label><input id="password" name="password" type="password" required>
<p><button type="submit">Sign in</button></p></form>`,
	);

const verifyPage = (email, error = "") =>
	page(
		"Verify your email",
		`<h1>Check your inbox</h1><p>We sent a 6-digit verification code to <strong>${email}</strong>. Enter it below to continue. The code can only be read from that mailbox.</p>
${error ? `<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/verify"><label for="code">Verification code</label><input id="code" name="code" inputmode="numeric" required>
<p><button type="submit">Verify</button></p></form>
<script>setInterval(async()=>{const r=await fetch('/verify/status');const s=await r.json();if(s.verified)location.href='/apply'},1500)</script>`,
	);

const applyPage = (error = "") =>
	page(
		"Application: Finance Officer",
		`<h1>Application: Finance Officer</h1>${error ? `<p class="error" role="alert">${error}</p>` : ""}
<form method="post" action="/apply/review" enctype="multipart/form-data">
<fieldset><legend>Your details</legend>
<label for="fullName">Full name</label><input id="fullName" name="fullName" required>
<label for="email">Email</label><input id="email" name="email" type="email" required>
<label for="phone">Phone number</label><input id="phone" name="phone" required>
<label for="city">Current city</label><input id="city" name="city" required></fieldset>
<fieldset><legend>Documents</legend>
<label for="resume">Resume / CV (PDF, required)</label><input id="resume" name="resume" type="file" accept=".pdf" required>
<label for="coverLetter">Cover letter (PDF, optional)</label><input id="coverLetter" name="coverLetter" type="file" accept=".pdf"></fieldset>
<fieldset><legend>Screening questions</legend>
<label for="experience">Years of relevant accounting experience</label><select id="experience" name="experience" required><option value="">Select</option><option>0-1</option><option>2-3</option><option>4-6</option><option>7+</option></select>
<label for="qualification">Highest accounting qualification</label><input id="qualification" name="qualification" required>
<p><strong>Are you legally authorised to work in Tanzania?</strong></p>
<label><input type="radio" name="workAuthorised" value="yes" required> Yes</label><label><input type="radio" name="workAuthorised" value="no"> No</label>
<p><strong>Do you hold a valid class B driving licence?</strong></p>
<label><input type="radio" name="drivingLicence" value="yes" required> Yes</label><label><input type="radio" name="drivingLicence" value="no"> No</label>
<label for="salary">Expected gross monthly salary (TZS)</label><input id="salary" name="salary" inputmode="numeric" required>
<label for="startDate">Earliest start date</label><input id="startDate" name="startDate" type="date" required>
<label for="motivation">Why do you want to work at Kilele Foods? (max 150 words)</label><textarea id="motivation" name="motivation" rows="5" required></textarea></fieldset>
<p><button type="submit">Review application</button></p></form>`,
	);

const reviewPage = (draft) =>
	page(
		"Review your application",
		`<h1>Review your application</h1><dl>${Object.entries(draft.fields)
			.map(([key, value]) => `<dt>${key}</dt><dd>${String(value).replace(/</g, "&lt;")}</dd>`)
			.join("")}${Object.entries(draft.files)
			.map(([key, file]) => `<dt>${key}</dt><dd>${file.filename} (${file.bytes} bytes)</dd>`)
			.join("")}</dl>
<p><a href="/apply">Edit</a></p><form method="post" action="/apply/submit"><button type="submit">Submit application</button></form>`,
	);

const confirmationPage = (reference) =>
	page(
		"Application received",
		`<h1>Application received</h1><p>Thank you. Your application for <strong>Finance Officer</strong> has been submitted.</p><p>Reference: <strong id="reference">${reference}</strong></p>`,
	);

async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	return Buffer.concat(chunks);
}

function parseMultipart(body, contentType) {
	const boundary = `--${/boundary=(.+)$/.exec(contentType)[1]}`;
	const fields = {};
	const files = {};
	for (const part of body.toString("latin1").split(boundary).slice(1, -1)) {
		const [rawHeaders, ...rest] = part.split("\r\n\r\n");
		const content = rest.join("\r\n\r\n").replace(/\r\n$/, "");
		const name = /name="([^"]+)"/.exec(rawHeaders)?.[1];
		const filename = /filename="([^"]*)"/.exec(rawHeaders)?.[1];
		if (!name) continue;
		if (filename !== undefined) {
			if (filename) files[name] = { filename, bytes: content.length, isPdf: content.startsWith("%PDF") };
		} else fields[name] = Buffer.from(content, "latin1").toString("utf8");
	}
	return { fields, files };
}

export async function startMockAts({ submissionsFile, port = 0 }) {
	const accounts = new Map();
	const sessions = new Map();
	const submissions = [];
	const events = [];

	const sessionOf = (request) => sessions.get(/sid=([\w-]+)/.exec(request.headers.cookie ?? "")?.[1]);
	const origin = () => `http://127.0.0.1:${server.address().port}`;
	const posted = new Date(Date.now() - 86_400_000).toISOString();
	const closes = new Date(Date.now() + 20 * 86_400_000).toISOString();
	const listing = (id, title, company, expertise, experience, lookingToHire, needs, applicationProcess) => ({
		_id: id,
		jobTitle: title,
		companyName: company,
		company: { company_name: company, company_industry: expertise },
		jobLocation: { city: "Arusha", region: "Arusha", country: "Tanzania" },
		employmentType: "Full-Time",
		jobExpertise: expertise,
		experienceQualification: { minimumLevelOfExperience: experience },
		jobDescription: { lookingToHire, responsibilities: [], qualifications: needs.map((value) => ({ value })) },
		salary: { minPay: 1, maxPay: 1 },
		closeAt: closes,
		createdAt: posted,
		get applicationProcess() {
			return applicationProcess();
		},
		toJSON() {
			return { ...this, applicationProcess: applicationProcess() };
		},
	});
	const listings = [
		listing(
			"a1a1a1a1a1a1a1a1a1a1a1a1",
			"Finance Officer",
			"Kilele Foods Ltd",
			"Accounting",
			"Mid-level(3-5 yrs)",
			"Own month-end close, supplier payments and management reporting for the Arusha plant of a food processing company.",
			[
				"Bachelor's degree in Accounting or Finance",
				"At least three years of accounting experience, ideally in manufacturing or FMCG",
				"CPA(T) or progress towards it",
				"Strong Excel; QuickBooks, Sage or similar",
				"A valid class B driving licence",
			],
			() => `<p>Apply online through our careers portal: ${origin()}/jobs/finance-officer</p>`,
		),
		listing(
			"b2b2b2b2b2b2b2b2b2b2b2b2",
			"Accountant",
			"Mlima Traders",
			"Accounting",
			"Mid-level(3-5 yrs)",
			"Run the books of a growing hardware wholesaler in Arusha: month-end close, bank reconciliations, supplier statements, stock counts and TRA returns, reporting to the owner.",
			[
				"Degree in Accounting",
				"Three or more years of accounting experience",
				"CPA(T) intermediate or above",
				"Experience with stock control",
			],
			() => "<p>Email your CV and a cover letter to <strong>careers@mlima-traders.example</strong></p>",
		),
		listing(
			"c3c3c3c3c3c3c3c3c3c3c3c3",
			"Consultant Neurosurgeon",
			"Arusha Referral Hospital",
			"Healthcare and Medical",
			"Senior-level(6+ yrs)",
			"Lead the neurosurgery unit and perform cranial and spinal procedures.",
			[
				"Doctor of Medicine with a Master of Medicine in Neurosurgery",
				"Registered with the Medical Council of Tanganyika",
				"Six years of post-qualification surgical practice",
			],
			() => `<p>Apply at ${origin()}/jobs/neurosurgeon</p>`,
		),
	];
	const json = (response, body, status = 200) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	const send = (response, status, html, headers = {}) => {
		response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
		response.end(html);
	};
	const redirect = (response, location, headers = {}) => {
		response.writeHead(303, { location, ...headers });
		response.end();
	};
	const openSession = (email, verified) => {
		const sid = randomUUID();
		sessions.set(sid, { email, verified, draft: null });
		return { "set-cookie": `sid=${sid}; Path=/; HttpOnly` };
	};

	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		const route = `${request.method} ${url.pathname}`;
		const session = sessionOf(request);
		events.push(route);

		if (route === "GET /jobs/finance-officer" || route === `GET /jobs/${listings[0]._id}`)
			return send(response, 200, jobPage);
		// A posting on some other site, which only takes applications by email.
		if (route === "GET /postings/accountant") {
			const job = listings[1];
			return send(
				response,
				200,
				`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${job.jobTitle} at ${job.companyName} · Arusha Jobs Board</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;line-height:1.5">
<h1>${job.jobTitle}</h1><p><strong>${job.companyName}</strong> · Arusha, Tanzania · Full-time</p>
<p>${job.jobDescription.lookingToHire}</p>
<h2>What you need</h2><ul>${job.jobDescription.qualifications.map(({ value }) => `<li>${value}</li>`).join("")}</ul>
<h2>How to apply</h2>${job.applicationProcess}</body></html>`,
			);
		}
		if (route === "GET /api/jobs/categories")
			return json(response, [
				{ _id: "Accounting", count: 2 },
				{ _id: "Healthcare and Medical", count: 1 },
			]);
		if (route === "GET /api/jobs") {
			const jobs = listings.map(({ jobDescription, applicationProcess, ...summary }) => summary);
			return json(response, [
				{
					totalJobs: jobs.length,
					totalJobsInPage: jobs.length,
					pageNumber: 1,
					pageSize: 50,
					paginatedJobs: [{ company: "mixed", companyDetails: {}, jobs }],
				},
			]);
		}
		if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
			const listing = listings.find((job) => job._id === url.pathname.split("/").pop());
			return listing
				? json(response, listing)
				: json(response, { statusCode: 500, message: "Internal server error" }, 500);
		}
		if (route === "GET /account") return send(response, 200, accountPage());
		if (route === "GET /account/sign-in") return send(response, 200, signInPage());
		if (route === "POST /account/create") {
			const form = new URLSearchParams((await readBody(request)).toString());
			const email = form.get("email");
			if (form.get("password") !== form.get("confirm"))
				return send(response, 200, accountPage("Passwords do not match."));
			if (accounts.has(email))
				return send(response, 200, accountPage("An account with this email already exists. Sign in instead."));
			accounts.set(email, { password: form.get("password"), verified: false });
			return redirect(response, "/verify", openSession(email, false));
		}
		if (route === "POST /account/sign-in") {
			const form = new URLSearchParams((await readBody(request)).toString());
			const account = accounts.get(form.get("email"));
			if (!account || account.password !== form.get("password"))
				return send(response, 200, signInPage("Wrong email or password."));
			return redirect(
				response,
				account.verified ? "/apply" : "/verify",
				openSession(form.get("email"), account.verified),
			);
		}
		if (route === "POST /__test/verify") {
			for (const open of sessions.values()) open.verified = true;
			for (const account of accounts.values()) account.verified = true;
			response.writeHead(200, { "content-type": "application/json" });
			return response.end(JSON.stringify({ verified: sessions.size }));
		}
		if (route === "GET /__test/state") {
			response.writeHead(200, { "content-type": "application/json" });
			return response.end(JSON.stringify({ accounts: [...accounts.keys()], submissions, events }));
		}

		if (!session) return redirect(response, "/account");

		if (route === "GET /verify")
			return session.verified ? redirect(response, "/apply") : send(response, 200, verifyPage(session.email));
		if (route === "GET /verify/status") {
			response.writeHead(200, { "content-type": "application/json" });
			return response.end(JSON.stringify({ verified: session.verified }));
		}
		if (route === "POST /verify") return send(response, 200, verifyPage(session.email, "That code is not correct."));
		if (!session.verified) return redirect(response, "/verify");

		if (route === "GET /apply") return send(response, 200, applyPage());
		if (route === "POST /apply/review") {
			const draft = parseMultipart(await readBody(request), request.headers["content-type"]);
			if (!draft.files.resume?.isPdf) return send(response, 200, applyPage("Please attach your resume as a PDF."));
			session.draft = draft;
			return send(response, 200, reviewPage(draft));
		}
		if (route === "POST /apply/submit") {
			if (!session.draft) return redirect(response, "/apply");
			const reference = `KF-${String(submissions.length + 1042)}`;
			submissions.push({ reference, account: session.email, submittedAt: new Date().toISOString(), ...session.draft });
			await fs.writeFile(submissionsFile, JSON.stringify(submissions, null, 2));
			session.draft = null;
			return send(response, 200, confirmationPage(reference));
		}
		return send(response, 404, page("Not found", "<h1>Page not found</h1>"));
	});

	await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
	return {
		origin: origin(),
		submissions,
		events,
		close: () => {
			server.closeAllConnections();
			return new Promise((resolve) => server.close(resolve));
		},
	};
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const ats = await startMockAts({ submissionsFile: "submissions.json", port: Number(process.env.PORT ?? 4477) });
	console.log(`Mock careers portal at ${ats.origin}/jobs/finance-officer`);
}
