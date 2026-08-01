import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ipcMain } from 'electron'
import si from 'systeminformation'
import { spawn } from 'child_process'
import wifi from 'node-wifi'

wifi.init({ iface: null })

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  return connections[0]?.ssid ?? 'Unbekannt'
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













app.whenReady().then(createWindow)
