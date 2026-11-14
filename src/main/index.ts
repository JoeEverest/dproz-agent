import path from "node:path";
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";
import { agent } from "./agent/manager";
import { onStatusChange, watchApplications } from "./applications";
import { loadConnection } from "./connection";
import { registerIpc } from "./ipc";
import { notifyStatus } from "./notify";
import { registerPreviewScheme, servePreviews } from "./preview";
import { startUpdateChecks } from "./updates";
import { ensureWorkspace } from "./workspace";

if (process.env.DPROZ_AGENT_USER_DATA) {
	app.setPath("userData", process.env.DPROZ_AGENT_USER_DATA);
	// A test build is signed differently from the installed app, so macOS would stop it with a keychain
	// prompt. Only a run with its own data folder may swap the keychain for Chromium's stand-in.
	if (process.env.DPROZ_AGENT_MOCK_KEYCHAIN) app.commandLine.appendSwitch("use-mock-keychain");
}
registerPreviewScheme();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function showWindow() {
	if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
	mainWindow.show();
	mainWindow.focus();
}

function createWindow() {
	const window = new BrowserWindow({
		width: 1360,
		height: 880,
		minWidth: 1040,
		minHeight: 680,
		show: false,
		title: "Dproz Agent",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		autoHideMenuBar: true,
		icon: process.platform === "darwin" ? undefined : appIcon(),
		trafficLightPosition: { x: 20, y: 18 },
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#151618" : "#f4f5f6",
		webPreferences: {
			preload: path.join(import.meta.dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			// The built-in PDF viewer, for previewing documents inside the window.
			plugins: true,
		},
	});

	window.once("ready-to-show", () => (process.env.DPROZ_AGENT_QUIET_WINDOW ? window.showInactive() : window.show()));
	window.on("close", (event) => {
		if (quitting || !tray) return;
		event.preventDefault();
		window.hide();
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url !== window.webContents.getURL()) event.preventDefault();
	});

	if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
	else void window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
	return window;
}

const appIcon = () => path.join(app.getAppPath(), "resources", "icon.png");

function createTray() {
	// macOS draws a monochrome template in the menu bar; Windows and Linux show the app icon.
	const onMac = process.platform === "darwin";
	const source = nativeImage.createFromPath(
		onMac ? path.join(app.getAppPath(), "resources", "trayTemplate.png") : appIcon(),
	);
	if (source.isEmpty()) return null;
	const icon = onMac ? source : source.resize({ width: 32, height: 32, quality: "best" });
	if (onMac) icon.setTemplateImage(true);
	const created = new Tray(icon);
	created.setToolTip("Dproz Agent");
	created.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Dproz Agent", click: showWindow },
			{ label: "Pause the agent", click: () => void agent.setPaused(true) },
			{ label: "Resume the agent", click: () => void agent.setPaused(false) },
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		]),
	);
	created.on("click", showWindow);
	return created;
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", showWindow);
	app.on("before-quit", () => {
		quitting = true;
		agent.stop();
	});
	app.on("activate", showWindow);
	app.on("window-all-closed", () => {
		if (!tray && process.platform !== "darwin") app.quit();
	});

	// Windows shows notifications and groups taskbar windows by this id.
	if (process.platform === "win32") app.setAppUserModelId("com.dproz.agent");

	void app.whenReady().then(async () => {
		// The packaged app carries its own icon; in development the dock would show Electron's.
		if (!app.isPackaged) app.dock?.setIcon(appIcon());
		await ensureWorkspace();
		await loadConnection();
		servePreviews();
		await agent.load();
		registerIpc();
		onStatusChange(notifyStatus);
		await watchApplications();
		tray = process.env.DPROZ_AGENT_NO_TRAY ? null : createTray();
		mainWindow = createWindow();
		startUpdateChecks();
	});
}
