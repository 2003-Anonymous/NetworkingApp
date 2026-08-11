# Right Container – Netzwerkdiagramm Guide

## Inhaltsverzeichnis
1. [Was du bauen wirst](#1-was-du-bauen-wirst)
2. [Pakete & Tools](#2-pakete--tools)
3. [Netzwerk scannen](#3-netzwerk-scannen)
4. [Geräte identifizieren](#4-geräte-identifizieren)
5. [Erweiterte Geräteerkennung](#5-erweiterte-geräteerkennung)
6. [Vollständiger Scan mit nmap](#6-vollständiger-scan-mit-nmap)
7. [Diagramm aufbauen mit vis.js](#7-diagramm-aufbauen-mit-visjs)
8. [Geräte anklicken & Infos anzeigen](#8-geräte-anklicken--infos-anzeigen)
9. [Netzwerktopologie erkennen](#9-netzwerktopologie-erkennen)
10. [Exportieren](#10-exportieren)
11. [Eigene Ideen](#11-eigene-ideen)
12. [Empfohlene Reihenfolge](#12-empfohlene-reihenfolge)

---

## 1. Was du bauen wirst

```
┌─────────────────────────────────────────────┐
│  [Scan]  [Export PNG]  [Export SVG]          │  ← rC-topbar
├─────────────────────────────────────────────┤
│                                              │
│           🌐 Router (192.168.1.1)            │
│          /        |         \                │
│    💻 PC    📱 Phone    🖨️ Printer           │  ← rC-mapContainer
│  192.168.x  192.168.x   192.168.x           │
│                                              │
├─────────────────────────────────────────────┤
│  Ausgewähltes Gerät: 192.168.1.5            │  ← rC-terminalContainer
│  MAC: AA:BB:CC:DD:EE:FF  Hersteller: Apple  │  (Geräteinfos)
└─────────────────────────────────────────────┘
```

---

## 2. Pakete & Tools

**✅ Für das Diagramm — `vis.js`:**
```bash
npm install vis-network
```
`vis-network` ist speziell für Netzwerkdiagramme gebaut. Es hat eingebaute Tree-Layouts, anklickbare Nodes, Icons und ist einfacher als D3.js.

**✅ Für Hersteller-Lookup (MAC → Marke):**
```bash
npm install mac-address-lookup
```
Gibt dir aus einer MAC-Adresse den Hersteller: `AA:BB:CC → Apple Inc.`

**✅ Für mDNS/Bonjour-Erkennung:**
```bash
npm install bonjour-service
```

**✅ Für vollständigen Netzwerkscan — nmap:**
Download: https://nmap.org/download.html

Findet alle Geräte im Netzwerk, auch solche die Pings blockieren (z.B. iPhones mit Firewall).

---

## 3. Netzwerk scannen

### ✅ Wie funktioniert das?

Windows führt eine sogenannte **ARP-Tabelle** — eine Liste aller Geräte, mit denen es kommuniziert hat. Du kannst sie mit `arp -a` auslesen:

```
Interface: 192.168.1.115
  Internetadresse    Physische Adresse    Typ
  192.168.1.1        dc-97-ba-ce-5f-31    dynamisch   ← Router
  192.168.1.5        aa-bb-cc-dd-ee-ff    dynamisch   ← Gerät
  192.168.1.23       11-22-33-44-55-66    dynamisch   ← Gerät
```

### ✅ Aktueller Ansatz: nmap + arp -a kombiniert

**Problem mit `arp -a` allein:** Zeigt nur Geräte die Windows kürzlich gesehen hat — neue Geräte und iPhones mit Firewall fehlen.

**Lösung:** nmap macht zuerst einen ARP-Scan der das gesamte Subnetz aktiv abfragt (ARP kann von keinem Gerät blockiert werden). Danach liest `arp -a` den befüllten Cache aus und liefert die MAC-Adressen.

```typescript
// In main.ts
ipcMain.handle('scan-network', async () => {
  const ifaces = await si.networkInterfaces()
  const wifiIface = ifaces.find((i: any) => i.type === 'wireless' && !i.internal)
  if (!wifiIface) throw new Error('Kein WLAN-Interface gefunden')

  const subnet = wifiIface.ip4.split('.').slice(0, 3).join('.')

  // nmap ARP-Scan → befüllt ARP-Cache (findet auch iPhones mit Firewall)
  await execAsync(`"C:/Program Files (x86)/Nmap/nmap.exe" -sn -PR ${subnet}.0/24`).catch(() => {})

  // arp -a liest MAC-Adressen aus dem befüllten Cache
  const { stdout } = await execAsync('arp -a')
  return stdout
})
```

> **Wichtig:** nmap's Output wird hier nicht direkt genutzt — er dient nur dazu den ARP-Cache zu befüllen. Die eigentlichen Daten (IP + MAC) kommen von `arp -a`.

### ✅ ARP-Output parsen

```javascript
function parseArp(output, gateway) {
  const devices = []
  const lines = output.split('\n')

  for (const line of lines) {
    const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([a-fA-F0-9:-]+)\s+(statisch|dynamisch|static|dynamic)/)
    if (!match) continue

    const ip = match[1]
    const mac = match[2].replace(/-/g, ":")

    // Broadcast und Multicast filtern
    if (mac === 'ff:ff:ff:ff:ff:ff') continue
    if (mac.startsWith('01:00:5e')) continue
    if (ip.startsWith('224.') || ip.startsWith('239.') || ip === '255.255.255.255') continue

    const vendor = lookup.getVendor(mac)
    const isGateway = ip === gateway

    devices.push({
      ip, mac,
      type: match[3],
      vendor,
      deviceType: isGateway ? 'router' : guessDeviceType(vendor)
    })
  }

  // Gateway an den Anfang stellen → wird Node 1 (Zentrum des Diagramms)
  const gatewayIdx = devices.findIndex(d => d.ip === gateway)
  if (gatewayIdx > 0) {
    const [router] = devices.splice(gatewayIdx, 1)
    devices.unshift(router)
  }

  return devices
}
```

---

## 4. Geräte identifizieren

### ✅ Hersteller aus MAC ermitteln

```javascript
import lookup from 'mac-address-lookup'
const vendor = lookup.getVendor('AA:BB:CC:DD:EE:FF')
// → "Apple Inc."
```

### ✅ Gerätetyp aus Hersteller ableiten

Eine Funktion mit vielen bekannten Herstellern:

```javascript
function guessDeviceType(vendor) {
  if (!vendor) return 'unknown'
  const v = vendor.toLowerCase()

  // Phones & Tablets
  if (v.includes('apple'))    return 'phone'
  if (v.includes('samsung'))  return 'phone'
  if (v.includes('xiaomi'))   return 'phone'
  if (v.includes('google'))   return 'phone'

  // PCs & Laptops
  if (v.includes('intel'))    return 'pc'
  if (v.includes('dell'))     return 'laptop'
  if (v.includes('lenovo'))   return 'laptop'
  if (v.includes('microsoft')) return 'pc'

  // Printers
  if (v.includes('hp') || v.includes('hewlett')) return 'printer'
  if (v.includes('canon'))    return 'printer'
  if (v.includes('epson'))    return 'printer'

  // Routers & APs
  if (v.includes('tp-link'))  return 'router'
  if (v.includes('fritz') || v.includes('avm')) return 'router'
  if (v.includes('ubiquiti')) return 'router'
  if (v.includes('cisco'))    return 'router'

  // NAS
  if (v.includes('synology')) return 'nas'
  if (v.includes('qnap'))     return 'nas'

  return 'unknown'
}
```

### ✅ Router erkennen

Das Gerät dessen IP dem Gateway entspricht (`si.networkGatewayDefault()`) ist der Router — unabhängig vom Hersteller.

---

## 5. Erweiterte Geräteerkennung

### ✅ Kombinierte Strategie beim Scan

Der initiale Scan lädt alle Geräte und reichert sie sofort mit Hostname und mDNS an, bevor das Diagramm aufgebaut wird — so haben alle Nodes beim ersten Erscheinen die richtigen Icons:

```javascript
async function scanNetwork() {
  const [output, gateway] = await Promise.all([
    window.ipcRenderer.invoke('scan-network'),
    window.ipcRenderer.invoke('get-default-gateway')
  ])
  const devices = parseArp(output, gateway)

  // Alle Geräte parallel mit Hostname + mDNS anreichern
  await Promise.all(devices.map(async (device) => {
    const [hostname, mdnsType] = await Promise.all([
      window.ipcRenderer.invoke('get-hostname', device.ip),
      window.ipcRenderer.invoke('get-mdns-type', device.ip)
    ])
    device.hostname = hostname

    // Priorität: mDNS > Hostname > Vendor-Schätzung
    if (mdnsType) {
      device.deviceType = mdnsTypeToDeviceType(mdnsType)
    } else if (hostname) {
      const fromHostname = typeFromHostname(hostname)
      if (fromHostname !== 'unknown') device.deviceType = fromHostname
    }
  }))

  createNetwork(devices)
}
```

---

### ✅ Methode 1 — Hostname-Auflösung

Reverse-DNS gibt dir oft den Gerätenamen direkt. In `main.ts`:

```typescript
ipcMain.handle('get-hostname', async (event, ip) => {
  const dns = await import('dns')
  const { promisify } = await import('util')
  const reverse = promisify(dns.reverse)
  try {
    const hostnames = await reverse(ip)
    return hostnames[0] ?? null
  } catch {
    return null
  }
})
```

Aus dem Hostnamen den Typ ableiten:
```javascript
function typeFromHostname(hostname) {
  if (!hostname) return 'unknown'
  const h = hostname.toLowerCase()
  if (h.includes('iphone') || h.includes('ipad'))   return 'phone'
  if (h.includes('macbook') || h.includes('mac'))   return 'laptop'
  if (h.includes('android'))                         return 'phone'
  if (h.includes('nas') || h.includes('synology'))  return 'nas'
  if (h.includes('fritz') || h.includes('router'))  return 'router'
  // ... weitere Keywords
  return 'unknown'
}
```

---

### ✅ Methode 2 — mDNS/Bonjour

Apple-Geräte, Chromecasts, Drucker, Smart-TVs etc. senden ihren Typ aktiv per mDNS:

```typescript
// main.ts — wird beim App-Start passiv ausgeführt
const BonjourLib = require('bonjour-service')
const bonjour = new BonjourLib()
const mdnsDevices = new Map()

bonjour.find({ type: 'http' }, (service: any) => {
  const ip = service.addresses?.[0]
  if (ip) mdnsDevices.set(ip, service.type)
})

ipcMain.handle('get-mdns-type', (event, ip) => {
  return mdnsDevices.get(ip) ?? null
})
```

| mDNS Typ | Gerät |
|---|---|
| `airplay` | Apple TV / Mac |
| `raop` | AirPlay Speaker |
| `ipp` / `pdl-datastream` | Drucker |
| `googlecast` | Chromecast / Google Home |
| `smb` | Windows PC / NAS |
| `afpovertcp` | Mac (AFP) |
| `http` | Router / NAS Webinterface |

> **Wichtig:** Bonjour läuft passiv im Hintergrund ab dem App-Start — so hat es Zeit Geräte zu entdecken bevor der Scan ausgelöst wird.

---

### ✅ Methode 3 — Port-Scanning

Bestimmte offene Ports verraten den Gerätetyp eindeutig:

```typescript
ipcMain.handle('scan-ports', async (event, ip) => {
  const portsToCheck = [
    { port: 80,    type: 'router/nas' },
    { port: 443,   type: 'router/nas' },
    { port: 445,   type: 'windows/nas' },
    { port: 548,   type: 'mac' },
    { port: 9100,  type: 'printer' },
    { port: 62078, type: 'iphone' },
    { port: 8009,  type: 'chromecast' },
    { port: 22,    type: 'linux/nas' },
  ]
  const results = await Promise.all(
    portsToCheck.map(async ({ port, type }) => ({
      port, type, open: await checkPort(ip, port)
    }))
  )
  return results.filter(r => r.open)
})
```

> Port-Scan wird beim Klick auf ein Gerät ausgeführt, nicht beim initialen Scan — sonst dauert der Scan für 20 Geräte sehr lange.

---

### ✅ Methode 4 — HTTP Banner

```typescript
ipcMain.handle('get-http-banner', async (event, ip) => {
  try {
    const response = await fetch(`http://${ip}`, { signal: AbortSignal.timeout(2000) })
    const html = await response.text()
    const match = html.match(/<title>(.*?)<\/title>/i)
    return match?.[1] ?? null
    // → "FRITZ!Box 7590" oder "Synology DiskStation"
  } catch {
    return null
  }
})
```

---

## 6. Vollständiger Scan mit nmap

### ✅ Warum nmap statt Ping-Sweep?

| Methode | Findet iPhones mit Firewall? | Geschwindigkeit |
|---|---|---|
| `arp -a` allein | ❌ Nur kürzlich gesehene Geräte | Sofort |
| Ping-Sweep + arp | ❌ iPhones blockieren Pings | ~30 Sekunden |
| **nmap ARP-Scan** | **✅ ARP kann nicht blockiert werden** | **~5 Sekunden** |

```typescript
// Aktueller scan-network Handler in main.ts
ipcMain.handle('scan-network', async () => {
  const ifaces = await si.networkInterfaces()
  const wifiIface = ifaces.find((i: any) => i.type === 'wireless' && !i.internal)
  if (!wifiIface) throw new Error('Kein WLAN-Interface gefunden')

  const subnet = wifiIface.ip4.split('.').slice(0, 3).join('.')

  await execAsync(`"C:/Program Files (x86)/Nmap/nmap.exe" -sn -PR ${subnet}.0/24`).catch(() => {})
  const { stdout } = await execAsync('arp -a')
  return stdout
})
```

---

## 7. Diagramm aufbauen mit vis.js

### ✅ Installation & Grundstruktur

```javascript
import { Network, DataSet } from 'vis-network/standalone'
```

vis.js braucht zwei Dinge:
- **Nodes** (Geräte) — jeder Node hat eine `id`, ein `label` und ein Icon
- **Edges** (Verbindungen) — jede Edge verbindet zwei Nodes via `from` und `to`

### ✅ Nodes mit Icons

```javascript
function createNodes(devices) {
  const nodes = new DataSet()
  for (let i = 0; i < devices.length; i++) {
    nodes.add({
      id: i + 1,
      label: `${devices[i].deviceType}\n${devices[i].ip}`,
      shape: 'image',
      image: `icons/${devices[i].deviceType}.svg`,
      ip: devices[i].ip,
      mac: devices[i].mac,
      vendor: devices[i].vendor,
      deviceType: devices[i].deviceType,
      hostname: devices[i].hostname ?? null
    })
  }
  return nodes
}
```

### ✅ Kanten vom Router zu allen Geräten

```javascript
function createEdges(devices) {
  const edges = new DataSet()
  for (let i = 1; i < devices.length; i++) {
    edges.add({ from: 1, to: i + 1 })  // Node 1 = Router (immer vorne)
  }
  return edges
}
```

> Node 1 ist immer der Router — `parseArp` sortiert das Gateway automatisch an den Anfang.

### ✅ Layout: Baum von oben nach unten

```javascript
const options = {
  layout: {
    hierarchical: {
      direction: 'UD',        // Up-Down
      sortMethod: 'directed',
    }
  },
  physics: { enabled: false }
}
```

### Icons einbinden

Lege SVG-Icons in `src/renderer/apps/FirstApp/icons/` ab:
- `router.svg`, `pc.svg`, `laptop.svg`, `phone.svg`
- `printer.svg`, `nas.svg`, `tv.svg`, `unknown.svg`

Gratis Icons: https://www.svgrepo.com

---

## 8. Geräte anklicken & Infos anzeigen

### ✅ Click-Handler

```javascript
network.on('click', async function (params) {
  if (params.nodes.length === 0) return
  const node = nodes.get(params.nodes[0])

  // Hostname bereits beim Scan geladen — nur bei Bedarf nochmal fetchen
  const hostname = node.hostname ?? await window.ipcRenderer.invoke('get-hostname', node.ip)

  showDeviceInfo(node, hostname)
})
```

### ✅ Infoanzeige

```javascript
function showDeviceInfo(device, hostname) {
  const container = document.getElementById('rC-terminalContainer')
  container.innerHTML = `
    <p>IP: ${device.ip}</p>
    <p>MAC: ${device.mac}</p>
    <p>Vendor: ${device.vendor}</p>
    <p>Device Type: ${device.deviceType}</p>
    <p>Hostname: ${hostname ?? 'Unbekannt'}</p>
  `
}
```

---

## 9. Netzwerktopologie erkennen

### Was ist die "echte" Topologie?

Aktuell verbindet das Diagramm alle Geräte direkt mit dem Router (flache Sterntopologie). Das ist korrekt für einfache Heimnetzwerke. In komplexeren Netzwerken könnte aber folgendes existieren:

```
[Router]
   ├── [Switch] ── [PC1]
   │              └── [PC2]
   └── [Access Point] ── [Phone]
                        └── [Tablet]
```

### Was ist erkennbar?

| Gerät | Erkennbar? | Methode |
|---|---|---|
| Router | ✅ Immer | Gateway-IP |
| Wireless Access Point | ⚠️ Heuristisch | MAC-Vendor (Ubiquiti, TP-Link, …) + Port 80 offen |
| Switch | ❌ Nicht möglich | Switch arbeitet auf Layer 2, für IP-Scans unsichtbar |
| Mehrere Subnetze | ⚠️ Nur wenn geroutet | Andere IP-Ranges separat scannen |

### Warum ist ein Switch unsichtbar?

Ein Switch operiert auf **Layer 2** (MAC-Ebene) und leitet Pakete weiter ohne eine eigene IP-Adresse sichtbar zu machen. Von deinem PC aus kannst du nicht unterscheiden ob zwei Geräte am gleichen Switch hängen oder direkt am Router.

Echte Topology-Discovery würde entweder:
- **SNMP** auf dem Router/Switch erfordern (Admin-Zugang nötig)
- **CDP/LLDP Protokoll-Sniffing** erfordern (Cisco-spezifisch, braucht Packet-Capture)

### Mögliche Verbesserung: Heuristische AP-Erkennung

Mit Port-Scan + HTTP-Banner können Geräte mit Webinterface (Port 80/443) als mögliche APs/Router erkannt werden. Diese könnten dann in einer Zwischenschicht im Diagramm dargestellt werden:

```javascript
// Beim Klick: wenn Port 80 offen ist, HTTP-Banner holen
const banner = await window.ipcRenderer.invoke('get-http-banner', device.ip)
// → "FRITZ!Box 7590" oder "Ubiquiti UniFi"
```

> Diese Methode gibt dir eine gut begründete Schätzung — keinen Beweis der echten Verbindung.

---

## 10. Exportieren

### PNG exportieren

vis.js hat eine eingebaute Methode:

```javascript
const canvas = network.canvas.frame.canvas
const dataUrl = canvas.toDataURL('image/png')

const link = document.createElement('a')
link.href = dataUrl
link.download = 'netzwerkdiagramm.png'
link.click()
```

### SVG exportieren

vis.js rendert auf einem Canvas (kein SVG). Einfachste Lösung: nur PNG anbieten. Für SVG: Paket `html2canvas` oder Wechsel auf Cytoscape.js.

---

## 11. Eigene Ideen

### Live-Updates
Scanne alle 30 Sekunden neu und aktualisiere das Diagramm — neue Geräte erscheinen, verschwundene werden grau.

### Gerät anpingen
Rechtsklick auf einen Node → Kontextmenü → "Ping" → Latenz wird neben dem Icon angezeigt.

### Verbindungsqualität als Linienfarbe
Grüne Linie = niedrige Latenz, gelb = mittel, rot = hoch.

### Geräte manuell benennen
Klick auf ein Gerät → Name eingeben → in `localStorage` speichern.

### Wake-on-LAN
Sende ein Magic Packet an ein Gerät. Erfordert das `wol`-Paket.

---

## 12. Empfohlene Reihenfolge

1. ✅ `arp -a` in main.ts aufrufen, Rohdaten in DevTools ausgeben
2. ✅ Parser schreiben — Array von `{ ip, mac }` Objekten
3. ✅ vis.js mit Platzhalter-Daten testen (Diagramm sichtbar?)
4. ✅ Echte Scan-Daten ins Diagramm einfügen
5. ✅ Icons für Gerätetypen einbinden
6. ✅ Click-Handler + Infoanzeige unten
7. ✅ nmap für vollständigen Scan (findet auch iPhones)
8. ✅ Hostname-Auflösung + mDNS beim Scan laden (bessere Geräteerkennung)
9. ✅ Broadcast/Multicast filtern, Gateway automatisch als Router markieren
10. [ ] Export-Button (PNG)
11. [ ] Live-Updates (periodischer Re-Scan)

> **Genereller Tipp:** Trenne Scanning-Logik (main.ts) von Darstellungs-Logik (diagram.js) sauber. Die Renderer-Seite sollte nur fertige Arrays empfangen und anzeigen — nie selbst scannen.
