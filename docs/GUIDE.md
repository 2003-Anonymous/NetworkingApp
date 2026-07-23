# Networking App – Schritt-für-Schritt Guide

## Inhaltsverzeichnis
1. [Architektur verstehen](#1-architektur-verstehen)
2. [Pakete installieren](#2-pakete-installieren)
3. [IPC – Die Brücke](#3-ipc--die-brücke)
4. [Systeminfos lesen (systeminformation)](#4-systeminfos-lesen)
5. [Overview aufbauen](#5-overview-aufbauen)
6. [IP Information aufbauen](#6-ip-information-aufbauen)
7. [VPN aufbauen](#7-vpn-aufbauen)
8. [Settings aufbauen](#8-settings-aufbauen)
9. [Eigene Ideen für Settings](#9-eigene-ideen-für-settings)

---

## 1. Architektur verstehen

Electron hat **zwei separate Prozesse** – das ist das Wichtigste, das du verstehen musst:

```
┌─────────────────────────────────────────────┐
│  MAIN PROCESS (electron/main.ts)            │
│  → Läuft in Node.js                         │
│  → Hat Zugriff auf das Betriebssystem       │
│  → Kann Netzwerkinfos lesen, Prozesse       │
│    starten, Dateien schreiben etc.          │
└──────────────────┬──────────────────────────┘
                   │  IPC (Inter-Process Communication)
                   │  = Nachrichten hin und her schicken
┌──────────────────▼──────────────────────────┐
│  RENDERER PROCESS (src/renderer/)           │
│  → Läuft im Browser (Chromium)              │
│  → Hat KEIN Zugriff auf Node.js             │
│  → Zeigt nur die UI an                      │
└─────────────────────────────────────────────┘
```

**Was das für dich bedeutet:**
- Netzwerkdaten lesen → **main.ts**
- Daten anzeigen → **renderer (HTML/JS)**
- Kommunikation zwischen beiden → **IPC via preload.ts**

---

## 2. Pakete installieren

Du brauchst nur **ein** Paket für fast alle Netzwerkinfos:

```bash
npm install systeminformation
```

`systeminformation` kann dir geben:
- Netzwerkgeschwindigkeit (Upload/Download in Echtzeit)
- Verbundenes WLAN / Netzwerk
- IP-Adressen (IPv4, IPv6, MAC, Gateway, DNS)
- Netzwerkinterfaces

Für die WLAN-Verwaltung (verbinden/trennen) auf Windows:
```bash
npm install node-wifi
```

> **Aufgabe:** Schau dir die Doku von `systeminformation` an:
> https://systeminformation.io/
> Suche dort nach `networkInterfaces` und `networkStats` – das sind deine zwei wichtigsten Funktionen.

---

## 3. IPC – Die Brücke

IPC ist wie ein Telefon zwischen Main und Renderer. Es gibt zwei Arten:

### a) Renderer fragt, Main antwortet (`invoke` / `handle`)
Gut für: "Gib mir die aktuellen IP-Infos"

```
Renderer  →  ipcRenderer.invoke('get-ip-info')  →  Main
Renderer  ←  return { ip: '192.168.1.115', ... }  ←  Main
```

### b) Main schickt von sich aus (`send` / `on`)
Gut für: Live-Updates der Netzwerkgeschwindigkeit alle X Sekunden

```
Main  →  win.webContents.send('network-speed', { up: 5, down: 12 })  →  Renderer
```

### So erweiterst du `electron/main.ts`:

```typescript
import { ipcMain } from 'electron'
import si from 'systeminformation'

// Renderer fragt → Main antwortet
ipcMain.handle('get-network-info', async () => {
  const interfaces = await si.networkInterfaces()
  return interfaces
})

// Alle 2 Sekunden Geschwindigkeit schicken
setInterval(async () => {
  const stats = await si.networkStats()
  win?.webContents.send('network-speed', stats[0])
}, 2000)
```

### So erweiterst du `electron/preload.ts`:

Aktuell ist dein preload sehr generisch (übergibt alle IPC-Funktionen direkt).
Das funktioniert, aber für mehr Kontrolle kannst du später spezifische Funktionen
exposieren. Für jetzt reicht dein bestehendes preload.

### So rufst du es im Renderer auf:

```javascript
// In einer .js Datei, die du in index.html einbindest
const info = await window.ipcRenderer.invoke('get-network-info')
console.log(info) // Array mit Netzwerkinterfaces

window.ipcRenderer.on('network-speed', (event, stats) => {
  console.log('Download:', stats.rx_sec, 'bytes/s')
})
```

> **Aufgabe:** Erstelle eine Datei `src/renderer/apps/FirstApp/app.js`.
> Binde sie in `index.html` ein mit `<script src="app.js" type="module"></script>`.
> Mach einen ersten `invoke`-Call und logge das Ergebnis in der DevConsole
> (F12 in der Electron-App).

---

## 4. Systeminfos lesen

### Welche `systeminformation`-Funktionen brauchst du?

| Was du willst | Funktion | Wichtige Felder |
|---|---|---|
| IP, MAC, Gateway | `si.networkInterfaces()` | `ip4`, `mac`, `gateway4`, `ip6` |
| Download/Upload live | `si.networkStats('Schnittstellenname')` | `rx_sec`, `tx_sec` |
| WLAN-Netzwerkname | `si.wifiConnections()` | `ssid`, `security`, `quality` |
| DNS-Server | `si.networkInterfaces()` | `dnsSuffix` (oder via OS-Befehl) |
| DHCP aktiv? | `si.networkInterfaces()` | `dhcp` (boolean) |

### Tipp: Teste zuerst in Node.js

Bevor du IPC baust, teste die Funktionen einfach direkt:

```typescript
// Temporär in main.ts, nur zum Testen:
import si from 'systeminformation'

app.whenReady().then(async () => {
  const ifaces = await si.networkInterfaces()
  console.log(JSON.stringify(ifaces, null, 2))  // In der Terminal-Konsole sichtbar
  createWindow()
})
```

Schau dir die Ausgabe an – so lernst du, welche Felder existieren.

---

## 5. Overview aufbauen

Die Overview soll zeigen:
- Verbundenes Netzwerk (SSID)
- Download / Upload Geschwindigkeit (live)
- VPN Status (aktiv / nicht aktiv)

### Schritt-für-Schritt:

**1.** Erstelle im HTML einen sauberen HTML-Aufbau für `#lC-overview`:

```html
<div id="lC-overview">
  <h3>Overview</h3>
  <div class="info-row">
    <span class="label">Netzwerk</span>
    <span id="ov-ssid">–</span>
  </div>
  <div class="info-row">
    <span class="label">Download</span>
    <span id="ov-download">–</span>
  </div>
  <div class="info-row">
    <span class="label">Upload</span>
    <span id="ov-upload">–</span>
  </div>
  <div class="info-row">
    <span class="label">VPN</span>
    <span id="ov-vpn-status" class="status-inactive">Nicht verbunden</span>
  </div>
</div>
```

**2.** Im `app.js` die Live-Updates empfangen und ins DOM schreiben:

```javascript
window.ipcRenderer.on('network-speed', (event, stats) => {
  const dlMB = (stats.rx_sec / 1024 / 1024).toFixed(2)
  const ulMB = (stats.tx_sec / 1024 / 1024).toFixed(2)
  
  document.getElementById('ov-download').textContent = dlMB + ' MB/s'
  document.getElementById('ov-upload').textContent = ulMB + ' MB/s'
})
```

**3.** SSID beim Start laden:

```javascript
const wifiList = await window.ipcRenderer.invoke('get-wifi-connections')
document.getElementById('ov-ssid').textContent = wifiList[0]?.ssid ?? 'Unbekannt'
```

> **Aufgabe:** Warum `?? 'Unbekannt'`? Schau nach, was der `??` (Nullish Coalescing)
> Operator in JavaScript macht.

---

## 6. IP Information aufbauen

### Anzeigen

Die IP-Infos kommen aus `si.networkInterfaces()`. Du bekommst ein Array –
du willst nur den aktiven WLAN-Adapter (nicht Loopback etc.).

**Aufgabe:** Finde heraus, wie du das richtige Interface filterst. Tipp: Schaue
auf das Feld `type` (es gibt `"wireless"`, `"wired"`, `"virtual"`).

```javascript
const ifaces = await window.ipcRenderer.invoke('get-network-info')
const wifi = ifaces.find(i => i.type === 'wireless' && !i.internal)
```

Zeige dann die relevanten Felder an:
- IPv4-Adresse
- Subnetzmaske
- Gateway
- DNS-Server
- MAC-Adresse
- DHCP aktiv?
- IPv6-Adresse

### Bearbeiten (IP manuell setzen)

Das ist der schwierige Teil: IP-Einstellungen ändern erfordert **Administratorrechte**
und geht über Windows-Befehle (`netsh`).

**Konzept:**

```
User ändert IP im Formular → klickt "Speichern"
  → Renderer sendet invoke('set-ip', { ip, subnet, gateway })
  → Main führt `netsh`-Befehl aus
  → Main gibt Erfolg/Fehler zurück
```

**Der netsh-Befehl** (in main.ts, mit `child_process`):

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

ipcMain.handle('set-ip', async (event, { interfaceName, ip, subnet, gateway }) => {
  const cmd = `netsh interface ip set address "${interfaceName}" static ${ip} ${subnet} ${gateway}`
  try {
    await execAsync(cmd)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
```

> **Wichtig:** `netsh` braucht Admin-Rechte. Electron kann beim Start Admin-Rechte
> anfordern – schau nach `electron-sudo` oder starte die App als Administrator.

**Für den DHCP-Modus zurückschalten:**
```
netsh interface ip set address "WLAN" dhcp
```

**Im HTML** brauchst du ein Toggle: "Statisch / DHCP", und wenn Statisch aktiv ist,
erscheinen Input-Felder für IP, Subnetz, Gateway, DNS.

> **Aufgabe:** Baue ein Formular mit einem `<select>` oder zwei Radio-Buttons für
> "DHCP" / "Statisch". Mit JavaScript kannst du die Input-Felder per
> `element.style.display = 'none'` verstecken oder zeigen.

---

## 7. VPN aufbauen

### Gratis VPN – Welche Option?

Die einfachste kostenlose Lösung ohne Account: **VPNBook** mit OpenVPN.

**Was du brauchst:**
1. OpenVPN CLI installiert (https://openvpn.net/community-downloads/)
2. Eine freie `.ovpn` Konfigurationsdatei von https://www.vpnbook.com/freevpn
3. Deine App startet/stoppt OpenVPN per `child_process`

**Konzept:**

```
User klickt "Verbinden"
  → invoke('vpn-connect', { configPath, username, password })
  → Main startet: openvpn --config pfad.ovpn
  → Main überwacht den Prozess-Output (sucht nach "Initialization Sequence Completed")
  → Main sendet Status-Updates an Renderer
```

**Teilcode für main.ts:**

```typescript
import { spawn } from 'child_process'
let vpnProcess: ReturnType<typeof spawn> | null = null

ipcMain.handle('vpn-connect', async (event, { configPath }) => {
  vpnProcess = spawn('openvpn', ['--config', configPath])
  
  vpnProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString()
    if (text.includes('Initialization Sequence Completed')) {
      win?.webContents.send('vpn-status', 'connected')
    }
  })
  
  vpnProcess.on('close', () => {
    win?.webContents.send('vpn-status', 'disconnected')
    vpnProcess = null
  })
})

ipcMain.handle('vpn-disconnect', async () => {
  vpnProcess?.kill()
})
```

**Im Renderer** hörst du auf `vpn-status` Events und aktualisierst das UI
(grüner Punkt = verbunden, roter Punkt = nicht verbunden).

> **Aufgabe:** VPNBook gibt username/password auf ihrer Website an (monatlich
> wechselnd). Überlege, ob du die Zugangsdaten im UI eingeben lässt oder
> hardcodest (hardcoden ist nur für Entwicklung okay!).

---

## 8. Settings aufbauen

### WLAN trennen

```bash
netsh wlan disconnect
```

→ Das kannst du per `execAsync` aus main.ts ausführen.

### Mit einem anderen WLAN verbinden

**Ansatz 1 – Vorhandene Profile:**
Windows speichert WLAN-Profile. Du kannst sie auflisten und verbinden:

```bash
netsh wlan show profiles          # Alle gespeicherten Netzwerke
netsh wlan connect name="SSID"   # Mit gespeichertem Netz verbinden
```

**Ansatz 2 – `node-wifi`:**
Das Paket `node-wifi` wrappet diese Befehle für dich:

```javascript
import wifi from 'node-wifi'
wifi.init({ iface: null })  // null = automatisch

// Verfügbare Netzwerke scannen
const networks = await wifi.scan()

// Verbinden
await wifi.connect({ ssid: 'MeinNetz', password: 'passwort' })
```

> **Aufgabe:** Baue eine Liste der verfügbaren Netzwerke (aus `wifi.scan()`),
> die der User anklicken kann. Bei Klick erscheint ein Passwort-Input.

---

## 9. Eigene Ideen für Settings

Hier sind weitere Features, die du einbauen könntest:

### DNS-Server ändern
Über `netsh` kannst du den DNS-Server setzen:
```bash
netsh interface ip set dns "WLAN" static 1.1.1.1    # Cloudflare DNS
netsh interface ip set dns "WLAN" static 8.8.8.8    # Google DNS
```
→ Baue ein Dropdown mit vordefinierten DNS-Anbietern (Cloudflare, Google, Custom).

### Ping-Tool
Pinge eine IP/Domain und zeige Latenz an:
```typescript
import ping from 'ping'  // npm install ping
const result = await ping.promise.probe('8.8.8.8')
// result.time = Latenz in ms
```

### Netzwerkadapter aktivieren / deaktivieren
```bash
netsh interface set interface "WLAN" enable
netsh interface set interface "WLAN" disable
```
→ Baue einen Toggle-Switch im UI.

### Firewall-Status anzeigen
```bash
netsh advfirewall show allprofiles
```
→ Zeige ob Firewall für Domäne/Privat/Öffentlich aktiv ist.

### Bandbreitenlimit simulieren (für Entwickler)
Fortgeschritten: Windows Traffic Control (`tc`-Äquivalent) ist komplex,
aber du könntest zumindest die aktuelle Bandbreite anzeigen und historisch
aufzeichnen (letzten 60 Sekunden als Graph).

---

## Empfohlene Reihenfolge

1. `app.js` erstellen, ersten IPC-Call testen (nur loggen)
2. `systeminformation` einbauen, Daten in Terminal ausgeben
3. Overview HTML + CSS aufbauen, Daten anzeigen (ohne Edit)
4. IP Information anzeigen (Read-only zuerst)
5. IP Information bearbeitbar machen (netsh)
6. VPN Section aufbauen
7. Settings aufbauen
8. Feinschliff: Styling, Error-Handling, Ladeanimationen

---

> **Genereller Tipp:** Arbeite immer erst im **Main-Process** (Daten holen,
> Befehle ausführen) und teste mit `console.log` in der Terminal-Konsole.
> Erst wenn die Daten stimmen, bau das UI drum herum.
