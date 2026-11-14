/**
 * Libre Franklin, the typeface of the Minimal layout in Dproz Fit Check. Fit Check fetches it from
 * Google Fonts. A resume here is printed on the user's own computer, possibly offline, so the font
 * ships with the app and is embedded in the page that is printed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const FACES = [
	{
		file: "libre-franklin-latin-wght-normal.woff2",
		range:
			"U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
	},
	{
		file: "libre-franklin-latin-ext-wght-normal.woff2",
		range:
			"U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
	},
];

let cached: Promise<string> | null = null;

/** The @font-face rules for a printed resume, with the font files inside them. Empty if they cannot be read. */
export function resumeFonts(): Promise<string> {
	cached ??= Promise.all(
		FACES.map(async ({ file, range }) => {
			const bytes = await fs.readFile(path.join(app.getAppPath(), "resources", "fonts", file));
			return `@font-face { font-family: "Libre Franklin"; font-style: normal; font-weight: 100 900; src: url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2"); unicode-range: ${range}; }`;
		}),
	).then(
		(faces) => faces.join("\n"),
		() => "",
	);
	return cached;
}
