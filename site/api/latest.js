import { latestRelease, releasesPage } from "../lib/release.js";

// What the landing page and the app's update check read. Cached at the edge so GitHub is asked rarely.
export default async function handler(_request, response) {
	try {
		const release = await latestRelease();
		if (!release) {
			response.status(404).json({ error: "No release has been published yet." });
			return;
		}
		const downloads = {};
		const files = {};
		for (const [platform, asset] of Object.entries(release.assets)) {
			downloads[platform] = asset.url;
			files[platform] = { name: asset.name, size: asset.size };
		}
		response.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=86400");
		response
			.status(200)
			.json({ version: release.version, publishedAt: release.publishedAt, page: releasesPage, downloads, files });
	} catch (cause) {
		response.status(502).json({ error: cause.message });
	}
}
