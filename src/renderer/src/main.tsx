import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
// The master resume is set in Libre Franklin, the typeface of Fit Check's Minimal resume layout.
import "@fontsource-variable/libre-franklin";
import "./styles.css";

if (window.desk.isDevelopment) document.title = "Dproz Agent (Development)";

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<div className="flex h-full flex-col">
			{window.desk.isDevelopment && (
				<div className="drag-region shrink-0 border-b border-line bg-sunk px-4 py-1 text-right text-xs font-semibold text-ink-2">
					Development
				</div>
			)}
			<div className="min-h-0 flex-1">
				<App />
			</div>
		</div>
	</StrictMode>,
);
