import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";
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
