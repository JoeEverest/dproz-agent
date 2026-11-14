import { latestRelease, releasesPage } from "../lib/release.js";

const guess = (userAgent = "") =>
	/Mac/i.test(userAgent) ? "mac" : /Windows/i.test(userAgent) ? "win" : /Linux/i.test(userAgent) ? "linux" : "";

// Sends the browser to the newest installer for its platform; the releases page when it cannot tell.
export default async function handler(request, response) {
	try {
		const platform = String(request.query.platform ?? "") || guess(request.headers["user-agent"]);
		const release = await latestRelease();
		response.setHeader("cache-control", "public, s-maxage=300");
		response.redirect(302, release?.assets[platform]?.url ?? releasesPage);
	} catch {
		response.redirect(302, releasesPage);
	}
}
