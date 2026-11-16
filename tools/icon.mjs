// Renders the app icon from the Dproz logo. Run: node tools/icon.mjs
//   build/icon.png         macOS (padded rounded square); electron-builder makes the .icns from it
//   build/icon-square.png  Windows installer
//   build/icons/*.png      Linux theme icons
//   resources/icon.png     the window and tray icon at runtime
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.resolve("tools/icon.html")}`, { waitUntil: "networkidle" });
await page.screenshot({ path: "build/icon.png", omitBackground: true });
await page.evaluate(() => document.body.classList.add("square"));
await page.screenshot({ path: "build/icon-square.png", omitBackground: true });
await page.setViewportSize({ width: 512, height: 512 });
await page.evaluate(() => {
	document.documentElement.style.zoom = "0.5";
});
await page.screenshot({ path: "resources/icon.png", omitBackground: true });
await fs.mkdir("build/icons", { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
	await page.setViewportSize({ width: size, height: size });
	await page.evaluate((pixels) => {
		document.documentElement.style.zoom = String(pixels / 1024);
	}, size);
	await page.screenshot({ path: `build/icons/${size}x${size}.png`, omitBackground: true });
}
await browser.close();
console.log("build/icon.png, build/icon-square.png, build/icons/*.png, resources/icon.png");
