/**
 * Updates, installed in place.
 *
 * The builds are not signed with an Apple Developer ID, and the standard macOS updater (Squirrel)
 * refuses to update an app that is not. So the app updates itself the plain way:
 *
 *   1. Ask the download site for the latest release and this platform's package.
 *   2. Download it into userData/updates and check it against the SHA-256 GitHub records for the file.
 *   3. On "Restart to update":
 *        macOS     a small script waits for the app to quit, swaps the .app bundle and opens the new one
 *        AppImage  the same, swapping the AppImage file
 *        Windows   the installer runs silently and starts the new version
 *
 * Nothing runs that the checksum did not vouch for. A copy that cannot replace itself (the .deb, an app
 * opened from the disk image, a development run) falls back to the download link.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateInfo } from "@shared/ipc";
import { isNewer } from "@shared/version";
import { app } from "electron";
import { broadcast } from "./events";

/** The download site: it answers with the latest release and where to get it. Empty turns checks off. */
const UPDATE_URL = process.env.DPROZ_AGENT_UPDATE_URL ?? "https://dproz-agent.vercel.app/api/latest";
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

type Package = { name: string; url: string; size: number; sha256?: string };
type Latest = {
	version?: string;
	page?: string;
	downloads?: Record<string, string>;
	updates?: Record<string, Package>;
};
type Place = {
	/** How this copy installs an update; undefined when it cannot. */
	kind?: "mac" | "appimage" | "win";
	/** The app bundle or AppImage file to replace. */
	target?: string;
	/** Why it cannot update in place, when that is something the user can fix. */
	blocked?: string;
};

// userData is moved for tests after this module loads, so the folder is worked out when it is needed.
const updatesDir = () => path.join(app.getPath("userData"), "updates");

let place: Place = {};
let info: UpdateInfo = { current: app.getVersion(), available: false, inPlace: false, stage: "idle" };
let wanted: { version: string; pack: Package } | undefined;
/** The checked download, ready to put in place (macOS: the unpacked .app). */
let staged: { version: string; path: string } | undefined;

function set(patch: Partial<UpdateInfo>) {
	info = { ...info, ...patch };
	broadcast("update:changed", info);
}

function writable(target: string) {
	try {
		accessSync(target, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/** Where this copy of the app lives, and whether it may replace itself. */
function findPlace(): Place {
	if (!app.isPackaged) return {};
	if (process.platform === "win32") return { kind: "win" };
	if (process.platform === "darwin") {
		const bundle = path.resolve(process.execPath, "..", "..", "..");
		if (!bundle.endsWith(".app")) return {};
		if (bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/")) {
			return {
				kind: "mac",
				target: bundle,
				blocked: "Move Dproz Agent to your Applications folder and open it from there to update without a download.",
			};
		}
		if (!writable(bundle) || !writable(path.dirname(bundle))) return {};
		return { kind: "mac", target: bundle };
	}
	const image = process.env.APPIMAGE;
	if (image && writable(image) && writable(path.dirname(image))) return { kind: "appimage", target: image };
	return {};
}

/** The site's names for this copy: the package it installs in place, and the installer to download by hand. */
function siteKeys() {
	if (process.platform === "darwin") return { pack: "mac", download: "mac" };
	if (process.platform === "win32") return { pack: "win", download: "win" };
	return process.env.APPIMAGE ? { pack: "linux", download: "linux" } : { pack: "", download: "deb" };
}

export const updateStatus = () => info;

export async function checkForUpdate(): Promise<UpdateInfo> {
	if (!UPDATE_URL || info.stage === "downloading") return info;
	try {
		const response = await fetch(UPDATE_URL, { signal: AbortSignal.timeout(15_000) });
		if (!response.ok) throw new Error(`The update server answered ${response.status}`);
		const latest = (await response.json()) as Latest;
		const keys = siteKeys();
		const available = Boolean(latest.version && isNewer(latest.version, info.current));
		const pack = place.kind && !place.blocked ? latest.updates?.[keys.pack] : undefined;
		wanted = available && latest.version && pack?.sha256 ? { version: latest.version, pack } : undefined;
		// A download that was checked earlier stays ready unless a newer release has replaced it.
		const ready = Boolean(wanted && staged?.version === wanted.version);
		if (!ready) staged = undefined;
		set({
			latest: latest.version,
			available,
			url: latest.downloads?.[keys.download] ?? latest.page,
			checkedAt: new Date().toISOString(),
			error: undefined,
			inPlace: Boolean(wanted),
			blocked: available ? place.blocked : undefined,
			stage: ready ? "ready" : "idle",
			progress: undefined,
			problem: undefined,
		});
	} catch (cause) {
		set({ checkedAt: new Date().toISOString(), error: (cause as Error).message });
	}
	return info;
}

function run(command: string, args: string[]) {
	return new Promise<string>((resolve, reject) => {
		execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (failure, stdout, stderr) => {
			if (failure) reject(new Error((stderr || failure.message).trim().split("\n").pop()));
			else resolve(stdout);
		});
	});
}

/** Unpack and check the download. Returns what the install puts in place. */
async function prepare(file: string, version: string) {
	if (place.kind === "appimage") {
		await chmod(file, 0o755);
		return file;
	}
	if (place.kind !== "mac") return file;
	const unpacked = path.join(updatesDir(), "unpacked");
	await mkdir(unpacked, { recursive: true });
	await run("/usr/bin/ditto", ["-x", "-k", file, unpacked]);
	const name = (await readdir(unpacked)).find((entry) => entry.endsWith(".app"));
	if (!name) throw new Error("The update has no app in it.");
	const bundle = path.join(unpacked, name);
	const plist = path.join(bundle, "Contents", "Info.plist");
	const found = (
		await run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist])
	).trim();
	if (found !== version) throw new Error(`The update says it is version ${found}, not ${version}.`);
	await rm(file, { force: true });
	return bundle;
}

/** Download the new version and check it. Nothing is installed until installUpdate. */
export async function downloadUpdate(): Promise<UpdateInfo> {
	const job = wanted;
	if (!job?.pack.sha256 || info.stage === "downloading" || info.stage === "ready") return info;
	const { pack, version } = job;
	const expected = job.pack.sha256.toLowerCase();
	set({ stage: "downloading", progress: 0, problem: undefined });
	try {
		await rm(updatesDir(), { recursive: true, force: true });
		await mkdir(updatesDir(), { recursive: true });
		const file = path.join(updatesDir(), path.basename(pack.name));
		const response = await fetch(pack.url, { redirect: "follow" });
		if (!response.ok || !response.body)
			throw new Error(`The download did not start (the server answered ${response.status}).`);
		const total = Number(response.headers.get("content-length")) || pack.size;
		const hash = createHash("sha256");
		let received = 0;
		let told = 0;
		const counted = new Transform({
			transform(chunk: Buffer, _encoding, done) {
				received += chunk.byteLength;
				hash.update(chunk);
				if (total && Date.now() - told > 250) {
					told = Date.now();
					set({ progress: Math.min(received / total, 1) });
				}
				done(null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(response.body as never), counted, createWriteStream(file));
		if (hash.digest("hex") !== expected) {
			await rm(file, { force: true });
			throw new Error("The download did not match its checksum, so it was deleted.");
		}
		staged = { version, path: await prepare(file, version) };
		set({ stage: "ready", progress: 1 });
	} catch (cause) {
		staged = undefined;
		set({ stage: "failed", progress: undefined, problem: (cause as Error).message });
	}
	return info;
}

const quoted = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The script that swaps in the new version once this process has gone, then starts it. */
function swapScript(target: string, fresh: string) {
	const old = `${target}.old-${Date.now()}`;
	// `open` starts the app without this process's environment, so a run pointed at another data
	// folder (the tests) hands its settings on; nothing is passed for an ordinary install.
	const handedOn = Object.entries(process.env)
		.filter(([name, value]) => name.startsWith("DPROZ_AGENT_") && value !== undefined)
		.map(([name, value]) => ` --env ${quoted(`${name}=${value}`)}`)
		.join("");
	const start =
		place.kind === "mac"
			? [`xattr -dr com.apple.quarantine ${quoted(target)} 2>/dev/null`, `open -n ${quoted(target)}${handedOn}`]
			: [`chmod +x ${quoted(target)}`, `nohup ${quoted(target)} >/dev/null 2>&1 &`];
	return [
		"#!/bin/sh",
		"# Written by Dproz Agent (src/main/updates.ts): put the new version in place once the app has quit.",
		`while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
		`if mv ${quoted(target)} ${quoted(old)}; then`,
		`  if mv ${quoted(fresh)} ${quoted(target)}; then rm -rf ${quoted(old)}; else mv ${quoted(old)} ${quoted(target)}; fi`,
		"fi",
		...start,
		"",
	].join("\n");
}

/** Quit, put the downloaded version in place, and start it. */
export async function installUpdate(): Promise<UpdateInfo> {
	if (info.stage !== "ready" || !staged) return info;
	try {
		if (place.kind === "win") {
			// electron-builder's installer: silent, told it is an update, and to start the app afterwards.
			spawn(staged.path, ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore" })
				.on("error", () => {})
				.unref();
		} else {
			if (!place.target) throw new Error("This copy cannot replace itself.");
			const script = path.join(updatesDir(), "install.sh");
			await writeFile(script, swapScript(place.target, staged.path), { mode: 0o755 });
			spawn("/bin/sh", [script], { detached: true, stdio: "ignore" })
				.on("error", () => {})
				.unref();
		}
	} catch (cause) {
		set({ stage: "failed", problem: (cause as Error).message });
		return info;
	}
	app.quit();
	return info;
}

export function startUpdateChecks() {
	place = findPlace();
	// Whatever an earlier version downloaded has been installed or abandoned by now.
	void rm(updatesDir(), { recursive: true, force: true }).catch(() => {});
	if (!UPDATE_URL) return;
	void checkForUpdate();
	setInterval(() => void checkForUpdate(), CHECK_EVERY_MS).unref();
}
