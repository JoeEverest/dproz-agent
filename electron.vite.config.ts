import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "electron-vite";

const shared = resolve("src/shared");

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "DPROZ_");
	// Some Linux machines refuse to start Electron's sandbox from node_modules. This is electron-vite's
	// own switch for that, asked for by name in .env.development.local and never set for a build.
	if (mode === "development" && process.platform === "linux" && env.DPROZ_AGENT_DEV_NO_SANDBOX === "1") {
		process.env.NO_SANDBOX = "1";
	}
	if (!env.DPROZ_API_KEY)
		console.warn("DPROZ_API_KEY is not set: the Dproz job search will not work. See .env.example.");

	return {
		main: {
			resolve: { alias: { "@shared": shared } },
			define: {
				__DPROZ_API_KEY__: JSON.stringify(env.DPROZ_API_KEY ?? ""),
				// The PostHog project key for anonymous usage figures. Without it the app sends none.
				__POSTHOG_KEY__: JSON.stringify(env.DPROZ_AGENT_POSTHOG_KEY ?? ""),
			},
		},
		preload: {
			resolve: { alias: { "@shared": shared } },
			build: {
				rollupOptions: {
					output: { format: "cjs", entryFileNames: "[name].cjs" },
				},
			},
		},
		renderer: {
			resolve: {
				alias: { "@shared": shared, "@": resolve("src/renderer/src") },
			},
			plugins: [react(), tailwindcss()],
		},
	};
});
