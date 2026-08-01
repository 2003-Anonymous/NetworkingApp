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




//Overview
async function loadOverview() {
    const wifiName = await window.ipcRenderer.invoke('get-network-name') //may be moved to "//important" section
    ovSsid.textContent = wifiName

    //more stuff to come
}

window.ipcRenderer.on('network-speed', (event, stats) => {
    const dlMB = stats.rx_sec.toFixed(2)
    const ulMB = stats.tx_sec.toFixed(2)
  
    document.getElementById('ov-download').textContent = dlMB + ' B/s'
    document.getElementById('ov-upload').textContent = ulMB + ' B/s'
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

wifiConnectBtn.addEventListener('click', async () => {
    const ssid = document.getElementById('wifi-networks').value
    const password = "gvbk-zvf9-f60c-evv4"
    await window.ipcRenderer.invoke('wifi-connect', {
        ssid,
        password
    })
    await loadOverview()
})

wifiRefreshBtn.addEventListener('click', async () => {
    await createWifiList()
})

//build
await loadOverview()
await loadIPInfo(wifi)



// IPv4-Adresse
// Subnetzmaske
// Gateway
// DNS-Server
// MAC-Adresse
// DHCP aktiv?
// IPv6-Adresse