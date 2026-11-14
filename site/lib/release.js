// Reads the latest public release of the app from GitHub.
const REPO = process.env.GITHUB_REPO ?? "JoeEverest/dproz-agent";

const EXTENSIONS = { mac: ".dmg", linux: ".AppImage", deb: ".deb" };

export const releasesPage = `https://github.com/${REPO}/releases/latest`;

/** The latest release, or null when none is published yet. */
export async function latestRelease() {
	const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
		headers: {
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			"user-agent": "dproz-agent-site",
		},
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
	const release = await response.json();
	const assets = {};
	for (const [platform, extension] of Object.entries(EXTENSIONS)) {
		const asset = release.assets.find((each) => each.name.endsWith(extension));
		if (asset) assets[platform] = { name: asset.name, size: asset.size, url: asset.browser_download_url };
	}
	return { version: release.tag_name.replace(/^v/, ""), publishedAt: release.published_at, assets };
}
