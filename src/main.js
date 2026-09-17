import { MAP, MAP_W, MAP_H } from './map.js'
import { TECH } from './tech.js'
import data from './data.json' with { type: 'json' }

/* ---------- clock ---------- */
const clock = document.getElementById('clock')
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit',
})
const tick = () => clock.textContent = fmt.format(new Date())
tick(); setInterval(tick, 1000)

/* ---------- contribution graph ---------- */
const graph = document.getElementById('graph')
const tip = document.getElementById('tip')
const total = document.getElementById('ctotal')
const picker = document.getElementById('year')
const gh = data.github
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

picker.innerHTML = gh.options.map(o => `<option value="${o.v}">${o.label}</option>`).join('')

let current
function render(key) {
  current = gh.years[key]
  const { days, pad } = current
  const peak = Math.max(...days, 1)
  const frag = document.createDocumentFragment()

  // the window's first day is rarely a Sunday; blank cells keep the rows straight
  for (let i = 0; i < pad; i++) {
    const p = document.createElement('i'); p.className = 'pad'; frag.appendChild(p)
  }
  days.forEach((n, i) => {
    const cell = document.createElement('i')
    // compress the long tail so one 40-commit day doesn't flatten the rest
    cell.style.setProperty('--a', (n === 0 ? 0.045 : 0.16 + 0.84 * (n / peak) ** 0.42).toFixed(3))
    cell.dataset.i = i
    frag.appendChild(cell)
  })
  graph.replaceChildren(frag)
  total.textContent = current.total.toLocaleString('en-US')
  tip.classList.remove('on')
}

picker.addEventListener('change', () => render(picker.value))
picker.value = gh.options[0].v
render(picker.value)

graph.addEventListener('pointermove', e => {
  const cell = e.target.closest('i:not(.pad)')
  if (!cell) return
  const i = +cell.dataset.i
  const d = new Date(current.from + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + i)
  tip.textContent = `${current.days[i]} on ${dayFmt.format(d).toLowerCase()}`
  tip.classList.add('on')
})
graph.addEventListener('pointerleave', () => tip.classList.remove('on'))

document.getElementById('built').textContent =
  'built ' + new Date(data.generated).toISOString().slice(0, 16).replace('T', ' ') + 'z'

/* ---------- games ---------- */
const compact = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'b'
  : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'm'
  : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n)

const cap = (name, visits) =>
  `<figcaption><span class="n">${name}</span><span class="v">${compact(visits)} visits</span></figcaption>`

document.getElementById('games').innerHTML =
  data.featured.map(g => `
    <a href="${g.url}" target="_blank" rel="noopener">
      <img src="${g.thumb}" alt="" loading="lazy" decoding="async">
      ${cap(g.name, g.visits)}
    </a>`).join('') +
  `<div class="more">
     <div class="mosaic">${data.more.thumbs
       .map(t => `<img src="${t}" alt="" loading="lazy" decoding="async">`).join('')}</div>
     ${cap(`${data.more.count} more`, data.more.visits)}
   </div>`

document.getElementById('visits').textContent =
  data.totalVisits.toLocaleString('en-US') + ' visits across every game'

/* ---------- tech ---------- */
document.getElementById('tech').innerHTML = TECH.map(t =>
  `<span><svg viewBox="0 0 24 24" aria-hidden="true">${
    t.svg ?? `<path d="${t.p}"/>`
  }</svg>${t.t}</span>`).join('')

/* ---------- dot map ---------- */
const COLORS = [
  [125, 178, 232],
  [226, 163, 86],
  [128, 206, 168],
  [206, 124, 124],
  [176, 186, 198],
]
const EDGE_K = 4
const cv = document.getElementById('bg')
const ctx = cv.getContext('2d', { alpha: false })
const pointer = { x: -9e3, y: -9e3 }
let dots = [], dpr = 1
let hub = null, nodes = [], edges = [], live = []

function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2)
  const w = innerWidth, h = innerHeight
  cv.width = w * dpr; cv.height = h * dpr
  cv.style.width = w + 'px'; cv.style.height = h + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // bleed the map past both edges so it never reads as a framed diagram
  const scale = (w * 1.32) / MAP_W
  const ox = (w - MAP_W * scale) / 2
  const oy = (h - MAP_H * scale) / 2

  // same equirectangular frame the land grid is sampled on, so a lon/lat lands
  // exactly where its dot would
  const project = (lat, lon) => [
    ox + ((lon + 180) / 360) * (MAP_W - 1) * scale,
    oy + ((84 - lat) / (84 + 58)) * (MAP_H - 1) * scale,
  ]
  const m = data.map
  hub = m ? project(m.hub[0], m.hub[1]) : null
  nodes = (m?.points || []).map(([lat, lon, k]) => ({ p: project(lat, lon), k }))
  edges = (m?.edges || []).map(([lat, lon]) => project(lat, lon))
  live = []

  dots = []
  for (let y = 0; y < MAP_H; y++) {
    const row = MAP[y]
    for (let x = 0; x < MAP_W; x++) {
      if (row[x] !== '1') continue
      const px = ox + x * scale, py = oy + y * scale
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue
      dots.push({ x: px, y: py, p: Math.random() * Math.PI * 2 })
    }
  }
}

const R = 150, R2 = R * R
function draw(t) {
  const w = innerWidth, h = innerHeight
  ctx.fillStyle = '#0b0b0c'
  ctx.fillRect(0, 0, w, h)
  const size = Math.max(1.15, (w * 1.32 / MAP_W) * 0.44)

  for (const d of dots) {
    const dx = d.x - pointer.x, dy = d.y - pointer.y
    const d2 = dx * dx + dy * dy
    let a = 0.052 + 0.016 * Math.sin(t / 2600 + d.p)   // slow breathing
    let ox = 0, oy = 0
    if (d2 < R2) {
      const k = 1 - Math.sqrt(d2) / R
      a += k * k * 0.34
      const push = k * k * 5
      const inv = 1 / (Math.sqrt(d2) || 1)
      ox = dx * inv * push; oy = dy * inv * push
    }
    ctx.fillStyle = `rgba(233,230,224,${a})`
    ctx.fillRect(d.x + ox, d.y + oy, size, size)
  }

  drawLinks(t)
  requestAnimationFrame(draw)
}

const rgba = (k, a) => {
  const c = COLORS[k] || COLORS[0]
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

// bow the line off the straight chord so overlapping routes stay legible
function bow([x1, y1], [x2, y2]) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  return [(x1 + x2) / 2 - ((y2 - y1) / len) * len * 0.16,
          (y1 + y2) / 2 + ((x2 - x1) / len) * len * 0.16]
}
const at = (a, c, b, u) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b

const LIFE = 3400        // ms a transient link exists
const SPAWN = 520        // ms between spawns
let nextSpawn = 0

function drawLinks(t) {
  if (!hub) return

  /* transient origins: fade in, run a mote into the hub, fade out */
  if (edges.length && t > nextSpawn) {
    nextSpawn = t + SPAWN * (0.6 + Math.random())
    if (live.length < 6) live.push({ p: edges[(Math.random() * edges.length) | 0], born: t })
  }
  live = live.filter(l => t - l.born < LIFE)

  for (const l of live) {
    const u = (t - l.born) / LIFE
    // ramp up over the first fifth, hold, then fall away
    const fade = Math.min(u / 0.2, 1) * (1 - Math.max(0, (u - 0.55) / 0.45)) ** 2
    const [cx, cy] = bow(l.p, hub)

    ctx.strokeStyle = rgba(EDGE_K, 0.13 * fade)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(l.p[0], l.p[1])
    ctx.quadraticCurveTo(cx, cy, hub[0], hub[1])
    ctx.stroke()

    const m = Math.min(1, u / 0.72)
    ctx.fillStyle = rgba(EDGE_K, 0.6 * fade)
    ctx.beginPath()
    ctx.arc(at(l.p[0], cx, hub[0], m), at(l.p[1], cy, hub[1], m), 1.5, 0, 7)
    ctx.fill()

    ctx.fillStyle = rgba(EDGE_K, 0.75 * fade)
    ctx.beginPath(); ctx.arc(l.p[0], l.p[1], 1.7, 0, 7); ctx.fill()
  }

  /* the permanent points */
  for (const n of nodes) {
    const [cx, cy] = bow(hub, n.p)
    ctx.strokeStyle = rgba(n.k, 0.16)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hub[0], hub[1])
    ctx.quadraticCurveTo(cx, cy, n.p[0], n.p[1])
    ctx.stroke()

    const u = ((t / 4200) + (n.p[0] % 97) / 97) % 1
    ctx.fillStyle = rgba(n.k, 0.5 * Math.sin(u * Math.PI))
    ctx.beginPath()
    ctx.arc(at(hub[0], cx, n.p[0], u), at(hub[1], cy, n.p[1], u), 1.6, 0, 7)
    ctx.fill()
  }

  for (const n of nodes) node(n.p, n.k, 2.1, t)
  node(hub, 0, 3.4, t)
}

function node([x, y], k, r, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t / 1400 + x)
  ctx.fillStyle = rgba(k, 0.14 + 0.1 * pulse)
  ctx.beginPath(); ctx.arc(x, y, r + 3.5 + pulse * 2.5, 0, 7); ctx.fill()
  ctx.fillStyle = rgba(k, 0.95)
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
}

addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY }, { passive: true })
addEventListener('pointerleave', () => { pointer.x = pointer.y = -9e3 })
addEventListener('resize', layout)
layout(); requestAnimationFrame(draw)
