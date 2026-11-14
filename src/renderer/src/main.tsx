import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
// The master resume is set in Libre Franklin, the typeface of Fit Check's Minimal resume layout.
import "@fontsource-variable/libre-franklin";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
