import { BrowserWindow, app, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import si from "systeminformation";
import { spawn } from "child_process";
import wifi from "node-wifi";
//#region electron/main.ts
wifi.init({ iface: null });
createRequire(import.meta.url);
var __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
var VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
var MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
var RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
var win;
function createWindow() {
	win = new BrowserWindow({
		icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
		webPreferences: { preload: path.join(__dirname, "preload.mjs") }
	});
	win.webContents.openDevTools();
	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	});
	if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(RENDERER_DIST, "index.html"));
}
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
		win = null;
	}
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
ipcMain.handle("get-network-interfaces", async () => {
	return await si.networkInterfaces();
});
ipcMain.handle("get-network-name", async () => {
	return (await si.wifiConnections())[0]?.ssid ?? "Unbekannt";
});
ipcMain.handle("get-default-network-interface", async () => {
	return await si.networkInterfaces("default");
});
ipcMain.handle("get-default-gateway", async () => {
	return await si.networkGatewayDefault();
});
setInterval(async () => {
	const stats = await si.networkStats();
	win?.webContents.send("network-speed", stats[0]);
}, 2e3);
var vpnProcess = null;
ipcMain.handle("vpn-connect", async (event, { configPath, username, password }) => {
	const fs = await import("fs");
	const os = await import("os");
	const authFile = path.join(os.tmpdir(), "vpn-auth.txt");
	fs.writeFileSync(authFile, `${username}\n${password}`);
	vpnProcess = spawn("C:/Program Files/OpenVPN/bin/openvpn.exe", [
		"--config",
		configPath,
		"--auth-user-pass",
		authFile
	]);
	setTimeout(() => {
		if (fs.existsSync(authFile)) fs.unlinkSync(authFile);
	}, 3e3);
	const checkOutput = (data) => {
		const text = data.toString();
		console.log("[OpenVPN]", text);
		if (text.includes("Initialization Sequence Completed")) win?.webContents.send("vpn-status", "connected");
	};
	vpnProcess.stdout?.on("data", checkOutput);
	vpnProcess.stderr?.on("data", checkOutput);
	vpnProcess.on("close", (code) => {
		console.log("[OpenVPN] closed with code", code);
		win?.webContents.send("vpn-status", "disconnected");
		vpnProcess = null;
	});
});
ipcMain.handle("vpn-disconnect", async () => {
	vpnProcess?.kill();
});
ipcMain.handle("wifi-disconnect", async () => {
	wifi.disconnect();
});
ipcMain.handle("wifi-scan", async () => {
	return await wifi.scan();
});
ipcMain.handle("wifi-connect", async (event, { ssid }) => {
	const { exec } = await import("child_process");
	const { promisify } = await import("util");
	await promisify(exec)(`netsh wlan connect name="${ssid}"`);
});
app.whenReady().then(createWindow);
//#endregion
export { MAIN_DIST, RENDERER_DIST, VITE_DEV_SERVER_URL };
