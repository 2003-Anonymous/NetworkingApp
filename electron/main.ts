import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ipcMain } from 'electron'
import si from 'systeminformation'
import { spawn } from 'child_process'
import wifi from 'node-wifi'
import { exec } from 'child_process'
import { promisify } from 'util'
import net from 'net'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load bonjour via require so Rolldown doesn't bundle it (avoids the ESM require('os') error)
const BonjourLib = require('bonjour-service')
const Bonjour = BonjourLib.default ?? BonjourLib
const bonjour = new Bonjour()
const mdnsDevices = new Map()
const execAsync = promisify(exec)
wifi.init({ iface: null })

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.openDevTools()

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})


//my stuff

ipcMain.handle('get-network-interfaces', async () => {
  const interfaces = await si.networkInterfaces()
  return interfaces
})

ipcMain.handle('get-network-name', async () => {
  const connections = await si.wifiConnections()
  return connections[0]?.ssid ?? 'Unknown'
})

ipcMain.handle('get-default-network-interface', async () => {
  const defaultInterface = await si.networkInterfaces('default')
  return defaultInterface
})

ipcMain.handle('get-default-gateway', async () => {
  const defaultGateway = await si.networkGatewayDefault()
  return defaultGateway
})

setInterval(async () => {
  const stats = await si.networkStats()
  win?.webContents.send('network-speed', stats[0])
}, 2000)

let currentSsid = ""
setInterval(async () => {
  let connections = await si.wifiConnections()
  let ssid = connections[0]?.ssid ?? 'Unknown'

  if (ssid != currentSsid) win?.webContents.send('wifi-changed', ssid)
  currentSsid = ssid
}, 3000)


//VPN
let vpnProcess: ReturnType<typeof spawn> | null = null

ipcMain.handle('vpn-connect', async (event, { configPath, username, password }) => {
  const fs = await import('fs')
  const os = await import('os')
  const authFile = path.join(os.tmpdir(), 'vpn-auth.txt')
  fs.writeFileSync(authFile, `${username}\n${password}`)

  vpnProcess = spawn('C:/Program Files/OpenVPN/bin/openvpn.exe', [
    '--config', configPath,
    '--auth-user-pass', authFile
  ])

  setTimeout(() => {
    if (fs.existsSync(authFile)) fs.unlinkSync(authFile)
  }, 3000)

  const checkOutput = (data: Buffer) => {
    const text = data.toString()
    console.log('[OpenVPN]', text)
    if (text.includes('Initialization Sequence Completed')) {
      win?.webContents.send('vpn-status', 'connected')
    }
  }

  vpnProcess.stdout?.on('data', checkOutput)
  vpnProcess.stderr?.on('data', checkOutput)

  vpnProcess.on('close', (code) => {
    console.log('[OpenVPN] closed with code', code)
    win?.webContents.send('vpn-status', 'disconnected')
    vpnProcess = null
  })
})

ipcMain.handle('vpn-disconnect', async () => {
  vpnProcess?.kill()
})



//wifi
ipcMain.handle('wifi-disconnect', async () => {
  wifi.disconnect()
})

ipcMain.handle('wifi-scan', async () => {
  const networks = await wifi.scan()
  return networks
})

ipcMain.handle('wifi-connect', async (event, { ssid }) => {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  await execAsync(`netsh wlan connect name="${ssid}"`)
})


//scanner
// async function pingSweep(subnet: string) {
//   const promises = []
//   for (let i = 1; i <= 254; i++) {
//     const ip = `${subnet}.${i}`
//     promises.push(
//       execAsync(`ping -n 1 -w 100 ${ip}`).catch(() => {})
//     )
//   }
//   await Promise.all(promises)
// }

ipcMain.handle('scan-network', async () => {
  const ifaces = await si.networkInterfaces()
  const wifiIface = ifaces.find((i: any) => i.type === 'wireless' && !i.internal)

  if (!wifiIface) throw new Error('No wireless interface found')

  const subnet = wifiIface?.ip4?.split('.').slice(0, 3).join('.')

  // Run nmap ARP scan — parse nmap's own output directly (it doesn't write to Windows ARP cache)
  const nmapPaths = [
    '"C:/Program Files (x86)/Nmap/nmap.exe"',
    '"C:/Program Files/Nmap/nmap.exe"',
    'nmap'
  ]
  for (const nmap of nmapPaths) {
    try {
      const { stdout } = await execAsync(`${nmap} -sn -PR ${subnet}.0/24`)
      console.log('[scan] nmap succeeded, returning output')
      return stdout
    } catch {
      // try next path
    }
  }
  console.log('[scan] nmap not found — falling back to arp -a')
  return await execAsync('arp -a').then(r => r.stdout)
})


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

bonjour.find({ type: 'http' }, (service: any) => {
  const ip = service.addresses?.[0]
  if (ip) mdnsDevices.set(ip, service.type)
})

ipcMain.handle('get-mdns-type', (event, ip) => {
  const service = mdnsDevices.get(ip) ?? null
  if (service) {
    if (service.name === 'airplay') return 'Apple TV / Mac'
    if (service.name === 'raop') return 'AirPlay'
    if (service.name === 'ipp') return 'Printer'
    if (service.name === 'pdl-datastream') return 'Printer'
    if (service.name === 'googlecast') return 'Chromecast'
    if (service.name === 'smb') return 'Windows PC / NAS'
    if (service.name === 'afpovertcp') return 'Mac(AFP)'
    if (service.name === 'http') return 'Router'
    return service.name
  }
})

function checkPort(ip: string, port: number, timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeout)
    socket.connect(port, ip, () => { socket.destroy(); resolve(true)})
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
  })
}

ipcMain.handle('scan-ports', async (event, ip) => {
  const portsToCheck= [
    { port: 80, type: 'router/nas' },
    { port: 443, type: 'router/nas' },
    { port: 445, type: 'windows/nas' },
    { port: 548, type: 'mac' },
    { port: 9100, type: 'printer' },
    { port: 62078, type: 'iphone' },
    { port: 8009, type: 'chromecast' },
    { port: 22, type: 'ssh' }
  ]

  const results = await Promise.all(
    portsToCheck.map(async ({ port, type}) => ({
      port, type, open: await checkPort(ip, port)
    }))
  )
  return results.filter(r => r.open)
})

ipcMain.handle('get-http-banner', async (event, ip) => {
  try {
    const response = await fetch('http://${ip}', { signal: AbortSignal.timeout(2000) })
    const html = await response.text()
    const match = html.match(/<title>(.*?)<\/title>/i)
    return match?.[1] ?? null
    
  } catch {
    return null
  }
})

app.whenReady().then(createWindow)
