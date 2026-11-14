import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getJob, listCategories, searchJobs } from "../dproz";
import { guarded } from "./result";

const readOnly = { annotations: { readOnlyHint: true, openWorldHint: true } };

export const dprozServer = () =>
	createSdkMcpServer({
		name: "dproz",
		version: "0.1.0",
		alwaysLoad: true,
		instructions:
			"Dproz is a Tanzanian job board. search_jobs matches titles loosely, so judge relevance yourself from the rows it returns and page through results. Call get_job before deciding anything about a job: only it has the description and how to apply.",
		tools: [
			tool(
				"search_jobs",
				"Search live jobs on Dproz (Tanzania). Returns up to 50 compact rows per page with the total and page count. The title match is loose and results are not ranked by relevance.",
				{
					query: z.string().optional().describe("Job title keywords, e.g. 'accountant'. Omit to list everything."),
					expertise: z
						.array(z.string())
						.optional()
						.describe("Exact expertise categories from list_categories, e.g. ['Accounting', 'Finance']."),
					region: z.string().optional().describe("Tanzanian region, e.g. 'Dar es Salaam'."),
					city: z.string().optional(),
					page: z.number().int().min(1).optional().describe("1-based page number."),
					postedAfter: z
						.string()
						.optional()
						.describe(
							"ISO date and time. Only jobs posted at or after it are returned; total still counts every match.",
						),
				},
				guarded(searchJobs),
				readOnly,
			),
			tool(
				"get_job",
				"Get one Dproz job in full: description, requirements, company profile, deadline, and how to apply (method, links and email addresses pulled from the posting).",
				{ id: z.string().describe("The job id from search_jobs.") },
				guarded(({ id }) => getJob(id)),
				readOnly,
			),
			tool(
				"list_categories",
				"List the expertise categories Dproz files jobs under, for the search_jobs expertise filter.",
				{},
				guarded(listCategories),
				readOnly,
			),
		],
	});
