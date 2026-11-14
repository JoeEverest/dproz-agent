// Renders tools/og.html to site/assets/og.png (1200 x 630). Run: node tools/og.mjs
import path from "node:path";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.resolve("tools/og.html")}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "site/assets/og.png" });
await browser.close();
console.log("site/assets/og.png");
