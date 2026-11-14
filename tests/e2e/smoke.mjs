import { createSandbox, launchApp, shot } from "./harness.mjs";

const sandbox = await createSandbox("smoke");
const { app, window } = await launchApp(sandbox);
await window.getByRole("heading", { name: "Set up your job-search agent" }).waitFor({ timeout: 20_000 });
await window
	.getByText(/Signed in|not signed in|Checking/)
	.first()
	.waitFor();
await window.waitForTimeout(6000);
console.log(await shot(window, "onboarding"));
console.log(await window.locator("ol").textContent());
await app.close();
