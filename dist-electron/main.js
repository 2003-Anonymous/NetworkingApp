import { BrowserWindow, app, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import si from "systeminformation";
import { exec, spawn } from "child_process";
import wifi from "node-wifi";
import { promisify } from "util";
import net from "net";
//#region electron/main.ts
var require = createRequire(import.meta.url);
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var BonjourLib = require("bonjour-service");
var bonjour = new (BonjourLib.default ?? BonjourLib)();
var mdnsDevices = /* @__PURE__ */ new Map();
var execAsync = promisify(exec);
wifi.init({ iface: null });
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
	return (await si.wifiConnections())[0]?.ssid ?? "Unknown";
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
var currentSsid = "";
setInterval(async () => {
	let ssid = (await si.wifiConnections())[0]?.ssid ?? "Unknown";
	if (ssid != currentSsid) win?.webContents.send("wifi-changed", ssid);
	currentSsid = ssid;
}, 3e3);
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
ipcMain.handle("scan-network", async () => {
	const wifiIface = (await si.networkInterfaces()).find((i) => i.type === "wireless" && !i.internal);
	if (!wifiIface) throw new Error("No wireless interface found");
	const subnet = wifiIface?.ip4?.split(".").slice(0, 3).join(".");
	for (const nmap of [
		"\"C:/Program Files (x86)/Nmap/nmap.exe\"",
		"\"C:/Program Files/Nmap/nmap.exe\"",
		"nmap"
	]) try {
		const { stdout } = await execAsync(`${nmap} -sn -PR ${subnet}.0/24`);
		console.log("[scan] nmap succeeded, returning output");
		return stdout;
	} catch {}
	console.log("[scan] nmap not found — falling back to arp -a");
	return await execAsync("arp -a").then((r) => r.stdout);
});
ipcMain.handle("get-hostname", async (event, ip) => {
	const dns = await import("dns");
	const { promisify } = await import("util");
	const reverse = promisify(dns.reverse);
	try {
		return (await reverse(ip))[0] ?? null;
	} catch {
		return null;
	}
});
bonjour.find({ type: "http" }, (service) => {
	const ip = service.addresses?.[0];
	if (ip) mdnsDevices.set(ip, service.type);
});
ipcMain.handle("get-mdns-type", (event, ip) => {
	const service = mdnsDevices.get(ip) ?? null;
	if (service) {
		if (service.name === "airplay") return "Apple TV / Mac";
		if (service.name === "raop") return "AirPlay";
		if (service.name === "ipp") return "Printer";
		if (service.name === "pdl-datastream") return "Printer";
		if (service.name === "googlecast") return "Chromecast";
		if (service.name === "smb") return "Windows PC / NAS";
		if (service.name === "afpovertcp") return "Mac(AFP)";
		if (service.name === "http") return "Router";
		return service.name;
	}
});
function checkPort(ip, port, timeout = 500) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		socket.setTimeout(timeout);
		socket.connect(port, ip, () => {
			socket.destroy();
			resolve(true);
		});
		socket.on("error", () => resolve(false));
		socket.on("timeout", () => {
			socket.destroy();
			resolve(false);
		});
	});
}
ipcMain.handle("scan-ports", async (event, ip) => {
	return (await Promise.all([
		{
			port: 80,
			type: "router/nas"
		},
		{
			port: 443,
			type: "router/nas"
		},
		{
			port: 445,
			type: "windows/nas"
		},
		{
			port: 548,
			type: "mac"
		},
		{
			port: 9100,
			type: "printer"
		},
		{
			port: 62078,
			type: "iphone"
		},
		{
			port: 8009,
			type: "chromecast"
		},
		{
			port: 22,
			type: "ssh"
		}
	].map(async ({ port, type }) => ({
		port,
		type,
		open: await checkPort(ip, port)
	})))).filter((r) => r.open);
});
ipcMain.handle("get-http-banner", async (event, ip) => {
	try {
		return (await (await fetch("http://${ip}", { signal: AbortSignal.timeout(2e3) })).text()).match(/<title>(.*?)<\/title>/i)?.[1] ?? null;
	} catch {
		return null;
	}
});
app.whenReady().then(createWindow);
//#endregion
export { MAIN_DIST, RENDERER_DIST, VITE_DEV_SERVER_URL };
