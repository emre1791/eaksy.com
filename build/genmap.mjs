import { feature } from 'topojson-client'
import { geoContains } from 'd3-geo'
import { writeFileSync } from 'fs'

const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json')
const topo = await res.json()
const land = feature(topo, topo.objects.land)

// sample a lon/lat grid; equirectangular so the browser can map it 1:1
const W = 260, H = 110
const rows = []
for (let y = 0; y < H; y++) {
  let row = ''
  const lat = 84 - (y / (H - 1)) * (84 + 58) // clip antarctica, keep iceland
  for (let x = 0; x < W; x++) {
    const lon = -180 + (x / (W - 1)) * 360
    row += geoContains(land, [lon, lat]) ? '1' : '0'
  }
  rows.push(row)
}
writeFileSync('/home/agent/site/src/map.js',
  `export const MAP_W=${W},MAP_H=${H};\nexport const MAP=${JSON.stringify(rows)};\n`)
const dots = rows.join('').split('').filter(c => c === '1').length
console.log('grid', W + 'x' + H, 'land dots', dots)
