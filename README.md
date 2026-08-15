# NetworkingApp - Internet Hub

A desktop networking utility built with **Electron + Vite 8 + TypeScript**. It gives the user a real-time view of their local network, connected devices, IP information, WiFi management and a VPN client.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 42 |
| Bundler | Vite 8 (Rolldown) via `vite-plugin-electron/simple` |
| Language | TypeScript (main process) + vanilla JS (renderer) |
| Network scanning | nmap (primary) → `arp -a` (fallback) |
| Network info | `systeminformation` |
| Device discovery | mDNS via `bonjour-service` (loaded with `createRequire` to avoid Rolldown bundling) |
| Vendor lookup | `mac-address-lookup` |
| Network diagram | `vis-network` (standalone build) |
| IPC | `ipcMain.handle` / `ipcRenderer.invoke` (request-response) + `webContents.send` (push) |

---

## Project Structure

```
NetworkingApp/
├── electron/
│   └── main.ts              # Main process — IPC handlers, WiFi watcher, VPN, mDNS
├── src/renderer/
│   └── apps/FirstApp/
│       ├── index.html       # App layout
│       ├── app.js           # Renderer logic — scan, WiFi, VPN, IP info
│       ├── diagram.js       # vis.js network diagram + SVG export
│       ├── style.css        # All styles (CSS variables, glitch card, radar loader, buttons)
│       └── templates/       # UI component snippets (uiverse.io)
├── vpn-configs/             # OpenVPN .ovpn config files
├── docs/
│   └── GUIDE_RightContainer.md
└── vite.config.ts
```

---

## Features

### Implemented

- **Network Scanner** — nmap ping-scan (`-sn -PR`) with MAC address extraction; falls back to `arp -a` if nmap is not installed
- **Device Type Detection** — layered: mDNS type → hostname keywords → MAC vendor lookup (~30 vendors)
- **Network Diagram** — vis.js hierarchical layout; click a node to resolve its hostname; export as self-contained SVG
- **IP Information** — IPv4/6, subnet, MAC, gateway, DNS, DHCP via `systeminformation`
- **WiFi Management** — scan available networks, connect (password overlay), disconnect; auto-detects network changes every 3 s and updates the header
- **VPN Client** — connects via OpenVPN configs; status pushed to renderer via IPC
- **Header Stats Bar** — SSID, download speed, upload speed, VPN status with inline SVG icons; live-updated

---

## Next Steps

### High Priority

- [ ] **Diagramm** - change the colors of the diagramm to make it more visible.
- [ ] **Fix WiFi connect for WPA3** - bypass `node-wifi` and call `netsh wlan connect name="<ssid>"` directly, which uses the existing Windows profile and supports WPA3.
- [ ] **Topology discovery** - detect switches, access points, and separate subnets so the diagram reflects the actual network structure.
- [x] **Scan button styling** - finish the CSS for the scan and download button.

### Medium Priority

- [ ] **Footer** — replace placeholder with something useful (e.g. last scan time, device count, local IP)
- [ ] **Terminal / log section** — the `#rC-terminalContainer` at the bottom right is currently empty; wire it up to show scan output, connection events, and errors
- [ ] **VPN country list** — replace hardcoded options with dynamically loaded `.ovpn` files from `vpn-configs/`
- [ ] **Node click detail panel** — when clicking a diagram node, show a richer panel (open ports, mDNS services, ping latency) instead of just resolving the hostname

### Lower Priority

- [ ] **WiFi signal strength** — show RSSI / signal bar next to each network in the dropdown
- [ ] **Packaging** — configure `electron-builder` for a distributable Windows installer (`.exe`)

---

## Running the App

```bash
git clone <repo-url>
cd NetworkingApp
npm install
```
Install Nmap with this Link:  nmap.org/download.html

```bash
npm run dev
```

> Run as **Administrator** for WiFi connect/disconnect to work (requires elevated privileges on Windows).

Nmap must be installed at one of these paths (checked in order):
- `C:/Program Files (x86)/Nmap/nmap.exe`
- `C:/Program Files/Nmap/nmap.exe`
- `nmap` (on PATH)
