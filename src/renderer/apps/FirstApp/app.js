import lookup from 'mac-address-lookup'
import { createNetwork } from './diagram.js'

//important
const ovSsid = document.getElementById('ov-ssid')
const ovVpnStatus = document.getElementById('ov-vpn-status')
const ifaces = await window.ipcRenderer.invoke('get-network-interfaces')
const wifi = ifaces.find(i => i.type === 'wireless' && !i.iternal)

//buttons
const vpnConnectBtn = document.getElementById('vpnConnectBtn')
const vpnDisconnectBtn = document.getElementById('vpnDisconnectBtn')
const wifiConnectBtn = document.getElementById('wifiConnectBtn')
const wifiDisconnectBtn = document.getElementById('wifiDisconnectBtn')
const wifiRefreshBtn = document.getElementById('wifiRefreshBtn')
const scannNetworkBtn = document.getElementById('scannNetwork')
const wlanLoginBtn = document.getElementById('wlanLoginBtn')
const wlanCancelBtn = document.getElementById('wlanCancelBtn')




//Overview
async function loadOverview() {
    const wifiName = await window.ipcRenderer.invoke('get-network-name') //may be moved to "//important" section
    ovSsid.textContent = wifiName

    //more stuff to come
}

window.ipcRenderer.on('network-speed', (event, stats) => {
    if (!stats?.rx_sec || !stats?.tx_sec) return
    const dlMB = stats.rx_sec.toFixed(2)
    const ulMB = stats.tx_sec.toFixed(2)
  
    document.getElementById('ov-download').textContent = dlMB + ' B/s'
    document.getElementById('ov-upload').textContent = ulMB + ' B/s'
})

window.ipcRenderer.on('wifi-changed', (event, ssid) => {
    ovSsid.textContent = ssid ?? 'Nicht verbunden'
    document.getElementById('ov-download').textContent = '0 B/s'
    document.getElementById('ov-upload').textContent = '0 B/s'
})

//IP Information
async function loadIPInfo(wifi, gateway) {
    document.getElementById('in-ip4').textContent = wifi.ip4
    document.getElementById('in-ip6').textContent = wifi.ip6
    document.getElementById('in-ip4-subnet').textContent = wifi.ip4subnet
    document.getElementById('in-ip6-subnet').textContent = wifi.ip6subnet
    document.getElementById('in-mac').textContent = wifi.mac
    document.getElementById('in-default-gateway').textContent = await window.ipcRenderer.invoke('get-default-gateway')
    document.getElementById('in-dns').textContent = wifi.dnsSuffix
    document.getElementById('in-dhcp').textContent = wifi.dhcp
}

vpnConnectBtn.addEventListener('click', async () => {
    //const username = document.getElementById('vpn-username').value
    //const password = document.getElementById('vpn-password').value
    if(ovVpnStatus.textContent !== "Connected"){
        const country = document.getElementById('vpn-country').value
        const username = "vpnbook"
        const password = "ueedn87"
        await window.ipcRenderer.invoke('vpn-connect', {
            configPath: `C:/Users/joshu/OneDrive/Desktop/NetworkingApp/vpn-configs/${country}.ovpn`,
            username,
            password
        })
    }
})



//VPN
vpnDisconnectBtn.addEventListener('click', async () => {
    await window.ipcRenderer.invoke('vpn-disconnect')
})

window.ipcRenderer.on('vpn-status', (event, status) => {
    if (status === 'connected') {
        ovVpnStatus.textContent = 'Connected'
        ovVpnStatus.style.color = 'green'
    } else {
        ovVpnStatus.textContent = 'Not Connected'
        ovVpnStatus.style.color = 'red'
    }
})


//wifi
async function createWifiList() {
    const networks = await window.ipcRenderer.invoke('wifi-scan')
    const wifiList = document.getElementById('wifi-networks')

    wifiList.innerHTML = ''

    networks.forEach(network => {
        const listItem = document.createElement('option')
        listItem.textContent = network.ssid
        listItem.value = network.ssid
        wifiList.appendChild(listItem)
    })
}

wifiDisconnectBtn.addEventListener('click', async () => {
    await window.ipcRenderer.invoke('wifi-disconnect')
    await loadOverview()
})

wifiConnectBtn.addEventListener('click', () => {
    const ssid = document.getElementById('wifi-networks').value
    document.getElementById('wlanSsidDisplay').textContent = ssid
    document.getElementById('wlanPasswordInput').value = ''
    document.getElementById('wlanLoginOverlay').style.display = 'flex'
})

wifiRefreshBtn.addEventListener('click', async () => {
    await createWifiList()
})

wlanLoginBtn.addEventListener('click', async () => {
    const wlanLoginOverlay = document.getElementById('wlanLoginOverlay')
    wlanLoginOverlay.style.display = "none"

    const ssid = document.getElementById('wifi-networks').value
    const password = document.getElementById('wlanPasswordInput').value
    await window.ipcRenderer.invoke('wifi-connect', {
        ssid,
        password
    })
    await loadOverview()
})

wlanCancelBtn.addEventListener('click', () => {
    const wlanLoginOverlay = document.getElementById('wlanLoginOverlay')
    wlanLoginOverlay.style.display = "none"
})

//scanner
async function scanNetwork() {
    const [output, gateway] = await Promise.all([
        window.ipcRenderer.invoke('scan-network'),
        window.ipcRenderer.invoke('get-default-gateway')
    ])
    const devices = output.includes('Nmap scan report') ? parseNmap(output, gateway) : parseArp(output, gateway)

    await Promise.allSettled(devices.map(async (device) => {
        const [hostname, mdnsType] = await Promise.all([
            window.ipcRenderer.invoke('get-hostname', device.ip).catch(() => null),
            window.ipcRenderer.invoke('get-mdns-type', device.ip).catch(() => null)
        ])
        device.hostname = hostname

        if (mdnsType) {
            device.deviceType = mdnsTypeToDeviceType(mdnsType)
        } else if (hostname) {
            const fromHostname = typeFromHostname(hostname)
            if (fromHostname !== 'unknown') device.deviceType = fromHostname
        }
    }))

    createNetwork(devices)
}

function parseArp(output, gateway) {
    const devices = []
    const lines = output.split('\n')

    for (const line of lines) {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([a-fA-F0-9:-]+)\s+(statisch|dynamisch|static|dynamic)/)
        if (!match) continue

        const ip = match[1]
        const mac = match[2].replace(/-/g, ":")

        // Filter broadcast and multicast entries
        if (mac === 'ff:ff:ff:ff:ff:ff') continue
        if (mac.startsWith('01:00:5e')) continue
        if (ip.startsWith('224.') || ip.startsWith('239.') || ip === '255.255.255.255') continue

        const vendor = lookup.getVendor(mac)
        const isGateway = ip === gateway

        const device = {
            ip,
            mac,
            type: match[3],
            vendor,
            deviceType: isGateway ? 'router' : guessDeviceType(vendor)
        }
        devices.push(device)
        console.log(`IP: ${device.ip}, MAC: ${device.mac}, Vendor: ${device.vendor}, DeviceType: ${device.deviceType}`)
    }

    const gatewayIdx = devices.findIndex(d => d.ip === gateway)
    if (gatewayIdx > 0) {
        const [router] = devices.splice(gatewayIdx, 1)
        devices.unshift(router)
    }

    return devices
}

function parseNmap(output, gateway) {
    const devices = []
    const blocks = output.split('Nmap scan report for ')

    for (const block of blocks) {
        if (!block.includes('Host is up')) continue

        const ipMatch = block.match(/\((\d+\.\d+\.\d+\.\d+)\)/) ?? block.match(/^(\d+\.\d+\.\d+\.\d+)/)
        if (!ipMatch) continue
        const ip = ipMatch[1]

        const macMatch = block.match(/MAC Address: ([0-9A-Fa-f:]+)\s+\(([^)]+)\)/i)
        if (!macMatch) continue
        const mac = macMatch[1].toUpperCase()
        const nmapVendor = macMatch[2]

        const lookupVendor = lookup.getVendor(mac)
        const vendor = lookupVendor ?? nmapVendor
        const isGateway = ip === gateway

        const device = {
            ip,
            mac,
            type: 'dynamic',
            vendor,
            deviceType: isGateway ? 'router' : guessDeviceType(vendor)
        }
        devices.push(device)
        console.log(`IP: ${device.ip}, MAC: ${device.mac}, Vendor: ${device.vendor}, DeviceType: ${device.deviceType}`)
    }

    const gatewayIdx = devices.findIndex(d => d.ip === gateway)
    if (gatewayIdx > 0) {
        const [router] = devices.splice(gatewayIdx, 1)
        devices.unshift(router)
    }

    return devices
}

scannNetworkBtn.addEventListener('click', async () => {
    document.getElementById('scanLoader').style.display = 'flex'
    await scanNetwork()
    document.getElementById('scanLoader').style.display = 'none'
})



function guessDeviceType(vendor) {
    if (!vendor) return 'unknown'
    const v = vendor.toLowerCase()

    // Phones & Tablets
    if (v.includes('apple')) return 'phone'
    if (v.includes('samsung')) return 'phone'
    if (v.includes('huawei')) return 'phone'
    if (v.includes('xiaomi')) return 'phone'
    if (v.includes('oneplus')) return 'phone'
    if (v.includes('google')) return 'phone'
    if (v.includes('motorola')) return 'phone'
    if (v.includes('oppo')) return 'phone'

    // PCs & Laptops
    if (v.includes('intel')) return 'pc'
    if (v.includes('realtek')) return 'pc'
    if (v.includes('vmware')) return 'pc'
    if (v.includes('microsoft')) return 'pc'
    if (v.includes('dell')) return 'laptop'
    if (v.includes('lenovo')) return 'laptop'
    if (v.includes('acer')) return 'laptop'

    // Printers
    if (v.includes('hewlett') || v.includes('hp')) return 'printer'
    if (v.includes('canon')) return 'printer'
    if (v.includes('epson')) return 'printer'
    if (v.includes('brother')) return 'printer'
    if (v.includes('lexmark')) return 'printer'

    // Routers & Access Points
    if (v.includes('tp-link')) return 'router'
    if (v.includes('netgear')) return 'router'
    if (v.includes('linksys')) return 'router'
    if (v.includes('ubiquiti')) return 'router'
    if (v.includes('avm') || v.includes('fritz')) return 'router'
    if (v.includes('zyxel')) return 'router'
    if (v.includes('d-link')) return 'router'
    if (v.includes('mikrotik')) return 'router'
    if (v.includes('cisco')) return 'router'

    // NAS
    if (v.includes('synology')) return 'nas'
    if (v.includes('qnap')) return 'nas'

    // Smart TV / Streaming
    if (v.includes('sony')) return 'tv'
    if (v.includes('lg')) return 'tv'
    if (v.includes('philips')) return 'tv'

    return 'unknown'
}

function mdnsTypeToDeviceType(mdnsType) {
    if (!mdnsType) return 'unknown'
    const t = mdnsType.toLowerCase()
    if (t === 'airplay') return 'tv'
    if (t === 'raop') return 'phone'
    if (t === 'ipp' || t === 'pdl-datastream') return 'printer'
    if (t === 'googlecast') return 'tv'
    if (t === 'smb') return 'pc'
    if (t === 'afpovertcp') return 'laptop'
    if (t === 'http') return 'router'
    return 'unknown'
}

function typeFromHostname(hostname) {
    if (!hostname) return 'unknown'
    const h = hostname.toLowerCase()
    if (h.includes('router')) return 'router'
    if (h.includes('switch')) return 'switch'
    if (h.includes('printer')) return 'printer'
    if (h.includes('laptop')) return 'laptop'
    if (h.includes('pc')) return 'pc'
    if (h.includes('phone')) return 'phone'
    if (h.includes('tablet')) return 'tablet'
    if (h.includes('camera')) return 'camera'
    if (h.includes('nas')) return 'nas'
    if (h.includes('server')) return 'server'
    if (h.includes('smart')) return 'smart'
    if (h.includes('tv')) return 'tv'
    if (h.includes('console')) return 'console'
    if (h.includes('ap')) return 'access point'
    if (h.includes('bridge')) return 'bridge'
    if (h.includes('dongle')) return 'dongle'
    if (h.includes('hub')) return 'hub'
    if (h.includes('modem')) return 'modem'
    if (h.includes('repeater')) return 'repeater'
    if (h.includes('extender')) return 'extender'
    if (h.includes('gateway')) return 'gateway'
    if (h.includes('iphone')) return 'phone'
    if (h.includes('ipad')) return 'tablet'
    if (h.includes('android')) return 'phone'
    if (h.includes('windows')) return 'pc'
    if (h.includes('mac')) return 'laptop'
    if (h.includes('xbox')) return 'xbox'

    return 'unknown' 
}

//build
await loadOverview()
await loadIPInfo(wifi)
await createWifiList()




// IPv4-Adresse
// Subnetzmaske
// Gateway
// DNS-Server
// MAC-Adresse
// DHCP aktiv?
// IPv6-Adresse