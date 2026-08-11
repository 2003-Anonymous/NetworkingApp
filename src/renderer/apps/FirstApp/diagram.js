import { Network, DataSet } from 'vis-network/standalone'

// const nodes = new DataSet([
//     { id: 1, label: 'Router\n192.168.1.1', shape: 'image', image: 'icons/router.svg' },
//     { id: 2, label: 'PC\n192.168.1.5', shape: 'image', image: 'icons/pc.svg' },
//     { id: 3, label: '?\n192.168.1.23', shape: 'image', image: 'icons/unknown.svg' },
// ])

// const edges = new DataSet([
//     { from: 1, to: 2 },
//     { from: 1, to: 3}
// ])

const container = document.getElementById('rC-mapContainer')
const downloadMapBtn = document.getElementById('downloadBtn')

let network = null

const options = {
    width: '100%',
    height: '100%',
    layout: {
        hierarchical: {
            direction: 'UD',
            sortMethod: 'directed',
            levelSeparation: 150,   // Abstand zwischen Ebenen (vertikal)
            nodeSpacing: 180,       // Abstand zwischen Nodes auf gleicher Ebene (horizontal)
            treeSpacing: 200,       // Abstand zwischen separaten Teilbäumen
        }
    },
    physics: {
        enabled: false
    },
    nodes: {
        size: 30,
        font: {
            size: 13,
            color: '#000000'
        }
    }
}

function createNodes(devices) {
    const nodes = new DataSet()
    for (let i = 0; i < devices.length; i++) {
        const node = {
            id: i + 1,
            label: `${devices[i].hostname ?? 'Unknown'}\n${devices[i].ip}`,
            shape: 'image',
            image: `icons/${devices[i].deviceType}.svg`,
            ip: devices[i].ip,
            mac: devices[i].mac,
            type: devices[i].type,
            vendor: devices[i].vendor,
            deviceType: devices[i].deviceType,
            hostname: devices[i].hostname ?? null
        }
        nodes.add(node)
    }
    return nodes
}

function createEdges(devices) {
    const edges = new DataSet()
    for (let i = 1; i < devices.length; i++) {
        edges.add({ from: 1, to: i + 1 })
    }
    return edges
}

export function createNetwork(devices) {
    const nodes = createNodes(devices)
    const edges = createEdges(devices)

    network = new Network(container, { nodes, edges }, options)

    network.on('click', async function (params) {
        if (params.nodes.length === 0) return
        const node = nodes.get(params.nodes[0])

        // Hostname already fetched during scan — only re-fetch if missing
        const hostname = node.hostname ?? await window.ipcRenderer.invoke('get-hostname', node.ip)

        showDeviceInfo(node, hostname)
    })
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
    if (h.includes('xbox')) return 'xbox'

    return 'unknown' 
}

function showDeviceInfo(device, hostname) {
    const container = document.getElementById('rC-terminalContainer')
    container.innerHTML = `
        <p>IP: ${device.ip}</p>
        <p>MAC: ${device.mac}</p>
        <p>Type: ${device.type}</p>
        <p>Vendor: ${device.vendor}</p>
        <p>Device Type: ${device.deviceType}</p>
        <p>Hostname: ${hostname}</p>
    `
}

downloadMapBtn.addEventListener('click', async () => {
    if (!network) return

    const positions = network.getPositions()
    const allNodes = network.body.data.nodes.get()
    const allEdges = network.body.data.edges.get()

    // Bounding box berechnen
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of Object.keys(positions)) {
        const { x, y } = positions[id]
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
    }

    const padding = 80
    const nodeSize = 30
    const offsetX = -minX + padding
    const offsetY = -minY + padding
    const svgWidth = maxX - minX + padding * 2
    const svgHeight = maxY - minY + padding * 2

    // Icons als Data-URLs einbetten (damit SVG eigenständig ist)
    const iconCache = {}
    for (const node of allNodes) {
        if (node.image && !iconCache[node.image]) {
            try {
                const res = await fetch(node.image)
                const blob = await res.blob()
                iconCache[node.image] = await new Promise(resolve => {
                    const reader = new FileReader()
                    reader.onload = () => resolve(reader.result)
                    reader.readAsDataURL(blob)
                })
            } catch {
                iconCache[node.image] = null
            }
        }
    }

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgWidth}" height="${svgHeight}">\n`
    svg += `  <rect width="100%" height="100%" fill="#ffffff"/>\n`

    // Kanten
    for (const edge of allEdges) {
        const from = positions[edge.from]
        const to = positions[edge.to]
        if (!from || !to) continue
        svg += `  <line x1="${from.x + offsetX}" y1="${from.y + offsetY}" x2="${to.x + offsetX}" y2="${to.y + offsetY}" stroke="#888" stroke-width="2"/>\n`
    }

    // Nodes (Icon + Label)
    for (const node of allNodes) {
        const pos = positions[node.id]
        if (!pos) continue
        const x = pos.x + offsetX
        const y = pos.y + offsetY
        const dataUrl = node.image ? iconCache[node.image] : null

        if (dataUrl) {
            svg += `  <image href="${dataUrl}" x="${x - nodeSize}" y="${y - nodeSize}" width="${nodeSize * 2}" height="${nodeSize * 2}"/>\n`
        } else {
            svg += `  <circle cx="${x}" cy="${y}" r="${nodeSize}" fill="#e0e0e0" stroke="#333" stroke-width="2"/>\n`
        }

        const lines = node.label ? node.label.split('\n') : []
        lines.forEach((line, i) => {
            svg += `  <text x="${x}" y="${y + nodeSize + 16 + i * 16}" text-anchor="middle" font-family="Consolas,monospace" font-size="12" fill="#333333">${escapeXml(line)}</text>\n`
        })
    }

    svg += '</svg>'

    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'network_map.svg'
    link.click()
    URL.revokeObjectURL(url)
})

function escapeXml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}