const API_URL = process.env.DPROZ_API_URL ?? "https://pxhwd7ngq1.execute-api.us-east-1.amazonaws.com/dev";
// Baked in at build time from DPROZ_API_KEY in .env (see .env.example); never committed.
declare const __DPROZ_API_KEY__: string | undefined;
const API_KEY = process.env.DPROZ_API_KEY ?? (typeof __DPROZ_API_KEY__ === "string" ? __DPROZ_API_KEY__ : "");
const SITE_URL = process.env.DPROZ_SITE_URL ?? "https://www.dproz.com";

export type JobSearch = {
	query?: string;
	expertise?: string[];
	region?: string;
	city?: string;
	page?: number;
	postedAfter?: string;
};

export type JobSummary = {
	id: string;
	url: string;
	title: string;
	company: string;
	location: string;
	expertise?: string;
	experience?: string;
	employmentType?: string;
	closesAt?: string;
	postedAt?: string;
};

export type JobDetail = JobSummary & {
	companyProfile: Record<string, string>;
	summary?: string;
	responsibilities: string[];
	qualifications: string[];
	skills: string[];
	education?: string;
	salary?: string;
	openings?: number;
	sourceListing?: string;
	howToApply: { text: string; method: "url" | "email" | "unknown"; urls: string[]; emails: string[] };
};

type RawItem = { value?: string };
type RawJob = Record<string, unknown> & {
	_id: string;
	jobTitle?: string;
	companyName?: string;
	company?: string | Record<string, unknown>;
	jobLocation?: { city?: string; region?: string; country?: string };
	jobExpertise?: string;
	employmentType?: string;
	experienceQualification?: { minimumLevelOfExperience?: string };
	closeAt?: string;
	createdAt?: string;
};

async function request<T>(path: string, params?: URLSearchParams): Promise<T> {
	const url = `${API_URL}${path}${params?.size ? `?${params}` : ""}`;
	const response = await fetch(url, {
		headers: { "x-api-key": API_KEY, Accept: "application/json" },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`Dproz API ${response.status} for ${path}`);
	return (await response.json()) as T;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export function stripHtml(html: string) {
	return html
		.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#39;|&rsquo;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n")
		.trim();
}

export function parseHowToApply(html: string | undefined): JobDetail["howToApply"] {
	const plain = stripHtml(html ?? "");
	const urls = [...new Set((plain.match(/https?:\/\/[^\s<>"')]+/g) ?? []).map((url) => url.replace(/[.,;:]+$/, "")))];
	const withoutUrls = urls.reduce((remaining, url) => remaining.replaceAll(url, " "), plain);
	const emails = [...new Set(withoutUrls.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])];
	const method = urls.length ? "url" : emails.length ? "email" : "unknown";
	return { text: plain, method, urls, emails };
}

const location = (job: RawJob) =>
	[...new Set([job.jobLocation?.city, job.jobLocation?.region, job.jobLocation?.country].filter(Boolean))].join(", ");

function summarize(job: RawJob): JobSummary {
	const companyName =
		text(job.companyName) ?? (typeof job.company === "object" ? text(job.company?.company_name) : text(job.company));
	return {
		id: job._id,
		url: `${SITE_URL}/jobs/${job._id}`,
		title: text(job.jobTitle) ?? "Untitled role",
		company: companyName ?? "Unknown company",
		location: location(job),
		expertise: text(job.jobExpertise),
		experience: text(job.experienceQualification?.minimumLevelOfExperience),
		employmentType: text(job.employmentType),
		closesAt: text(job.closeAt),
		postedAt: text(job.createdAt),
	};
}

type SearchResponse = [{ totalJobs?: number; pageSize?: number; paginatedJobs?: { jobs: RawJob[] }[] }?];

export async function searchJobs(search: JobSearch) {
	const page = search.page ?? 1;
	const params = new URLSearchParams({
		title: search.query ?? "",
		country: "Tanzania",
		region: search.region ?? "",
		city: search.city ?? "",
		pageNumber: String(page),
	});
	for (const expertise of search.expertise ?? []) params.append("jobExpertise[]", expertise);

	const [result] = await request<SearchResponse>("/jobs", params);
	const since = search.postedAfter ? Date.parse(search.postedAfter) : Number.NaN;
	const isRecent = (job: JobSummary) => Number.isNaN(since) || !job.postedAt || Date.parse(job.postedAt) >= since;
	const jobs = (result?.paginatedJobs ?? [])
		.flatMap((group) => group.jobs)
		.map(summarize)
		.filter(isRecent);
	const total = result?.totalJobs ?? 0;
	const pageSize = result?.pageSize ?? 50;
	return { total, page, pages: Math.max(1, Math.ceil(total / pageSize)), jobs };
}

const values = (items: unknown) =>
	Array.isArray(items) ? items.map((item: RawItem) => text(item?.value)).filter((value) => value !== undefined) : [];

function salaryText(salary: Record<string, unknown> | undefined) {
	const minimum = Number(salary?.minPay ?? 0);
	const maximum = Number(salary?.maxPay ?? 0);
	if (minimum <= 1 && maximum <= 1) return undefined;
	const range = minimum === maximum || maximum <= 1 ? `${minimum}` : `${minimum}–${maximum}`;
	return `${salary?.payCurrency ?? ""} ${range} ${String(salary?.payFrequency ?? "").toLowerCase()}`.trim();
}

function educationText(education: Record<string, unknown> | undefined) {
	if (!education) return undefined;
	const level = text(education.minEducationLevel);
	const preferred = text(education.preferredEducationLevel);
	const majors = Array.isArray(education.relevantMajors) ? education.relevantMajors.join(", ") : "";
	const parts = [
		level && `minimum ${level}`,
		preferred && preferred !== level && `preferred ${preferred}`,
		majors && `fields: ${majors}`,
	];
	return parts.filter(Boolean).join("; ") || undefined;
}

function companyProfile(company: unknown): Record<string, string> {
	if (!company || typeof company !== "object") return {};
	const source = company as Record<string, unknown>;
	const fields = {
		website: source.company_website,
		industry: source.company_industry,
		size: source.company_size_approx,
		headquarters: source.headquarters,
		linkedin: source.linkedin_url,
		about: source.about_us_summary,
	};
	return Object.fromEntries(
		Object.entries(fields).flatMap(([key, value]) => {
			const cleaned = text(value);
			return cleaned ? [[key, cleaned]] : [];
		}),
	);
}

export async function getJob(id: string): Promise<JobDetail> {
	if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error(`"${id}" is not a Dproz job id. Use an id returned by search_jobs.`);
	const job = await request<RawJob>(`/jobs/${id}`);
	const description = (job.jobDescription ?? {}) as Record<string, unknown>;
	return {
		...summarize(job),
		companyProfile: companyProfile(job.company),
		summary: text(description.lookingToHire),
		responsibilities: values(description.responsibilities),
		qualifications: values(description.qualifications),
		skills: values(job.skillsQualifications),
		education: educationText(job.educationQualification as Record<string, unknown> | undefined),
		salary: salaryText(job.salary as Record<string, unknown> | undefined),
		openings: typeof job.numberOfOpening === "number" ? job.numberOfOpening : undefined,
		sourceListing: text(job.additionalInformation),
		howToApply: parseHowToApply(text(job.applicationProcess)),
	};
}

export async function listCategories() {
	const categories = await request<{ _id: string; count: number }[]>("/jobs/categories");
	return categories.map(({ _id, count }) => ({ expertise: _id, jobsEverPosted: count }));
}
