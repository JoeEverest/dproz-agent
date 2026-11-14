import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { writeFileAtomic } from "./files";

const countPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

export async function renderPdf(htmlFile: string, pdfFile: string) {
	await fs.access(htmlFile);
	const window = new BrowserWindow({
		show: false,
		webPreferences: { sandbox: true, javascript: false, partition: "pdf-render" },
	});
	try {
		await window.loadFile(htmlFile);
		const pdf = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
		await fs.mkdir(path.dirname(pdfFile), { recursive: true });
		await writeFileAtomic(pdfFile, pdf);
		return { pages: countPages(pdf), bytes: pdf.length };
	} finally {
		window.destroy();
	}
}

/** Prints HTML that exists only in memory, so no stray .html file is left beside the PDF. */
export async function renderHtmlToPdf(html: string, pdfFile: string) {
	const directory = await fs.mkdtemp(path.join(app.getPath("temp"), "dproz-agent-"));
	const source = path.join(directory, "document.html");
	try {
		await fs.writeFile(source, html);
		return await renderPdf(source, pdfFile);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}
