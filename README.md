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

