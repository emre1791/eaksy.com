/* Static site. Knows nothing about github or roblox — it asks the api
 * service, server-side, and inlines the answer so the page arrives complete. */
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join, normalize } from 'path'
import { readdir } from 'fs/promises'
import { createHash } from 'crypto'

const ROOT = new URL(process.env.PUBLIC_DIR || './public/', import.meta.url).pathname
const PORT = Number(process.env.PORT || 8080)
const API = (process.env.API_ORIGIN || 'http://api:8080').replace(/\/+$/, '')
const TTL = Number(process.env.API_TTL_MS || 60000)
const BASES = (process.env.BASE_PATHS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}
const NO_CACHE = process.env.NO_CACHE === '1'
const files = new Map()

/* Assets are served under /a/<build>/… and cached immutably. The id is a hash
 * of their contents, so a deploy changes every URL and no browser can be left
 * running last week's main.js against this week's markup. Relative imports
 * inside a module resolve under the same prefix for free. */
const BUILD = await (async () => {
  const names = (await readdir(ROOT)).filter(n => n !== 'index.html').sort()
  const h = createHash('sha1')
  for (const n of names) h.update(n).update(await readFile(join(ROOT, n)))
  return h.digest('hex').slice(0, 12)
})()

async function load(p) {
  if (!NO_CACHE && files.has(p)) return files.get(p)
  const body = await readFile(join(ROOT, p))
  const entry = { body, etag: '"' + createHash('sha1').update(body).digest('base64url') + '"' }
  if (!NO_CACHE) files.set(p, entry)
  return entry
}

/* Thumbnails are few and small; holding them here means an api restart can't
 * blank the tiles. */
const imgs = new Map()

/* Last good payload from the api. Held indefinitely on failure: a page with
 * yesterday's numbers beats a blank one because the api is restarting. */
let snapshot = null, fetchedAt = 0, inflight = null

async function data() {
  if (snapshot && Date.now() - fetchedAt < TTL) return snapshot
  inflight ??= (async () => {
    try {
      const r = await fetch(`${API}/data`, { signal: AbortSignal.timeout(5000) })
      if (!r.ok) throw new Error(`api ${r.status}`)
      const next = await r.json()
      if (snapshot && next.generated !== snapshot.generated) imgs.clear()
      snapshot = next
      fetchedAt = Date.now()
    } catch (e) {
      console.error('api unreachable:', e.message, snapshot ? '(serving last known)' : '(no snapshot yet)')
      if (!snapshot) fetchedAt = Date.now() - TTL + 5000   // retry soon while cold
    } finally { inflight = null }
  })()
  await inflight
  return snapshot
}

const send = (res, code, type, body, extra = {}) => {
  res.writeHead(code, {
    'content-type': type, 'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin', ...extra,
  })
  res.end(body)
}

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0]))
  if (path.includes('\0')) return send(res, 400, 'text/plain', 'bad request')

  for (const base of BASES) {
    if (path === base) { res.writeHead(301, { location: base + '/' }); return res.end() }
    if (path.startsWith(base + '/')) { path = path.slice(base.length); break }
  }

  if (path === '/healthz') return send(res, 200, 'text/plain', 'ok')

  // /a/<build>/main.js — any build id resolves to the current file; stale HTML
  // simply gets today's asset rather than a 404
  let immutable = false
  const versioned = path.match(/^\/a\/[0-9a-f]{6,}(\/.+)$/)
  if (versioned) { path = versioned[1]; immutable = true }

  // Mirrored from the api so the browser never leaves this origin for an image.
  if (path.startsWith('/img/')) {
    const id = path.slice(5).replace(/\.png$/, '')
    if (!/^\d+$/.test(id)) return send(res, 400, 'text/plain', 'bad request')
    const hit = imgs.get(id)
    if (hit) return send(res, 200, 'image/png', hit, { 'cache-control': 'public, max-age=86400' })
    try {
      const r = await fetch(`${API}/img/${id}.png`, { signal: AbortSignal.timeout(10000) })
      if (!r.ok) return send(res, r.status, 'text/plain', 'not found')
      const buf = Buffer.from(await r.arrayBuffer())
      imgs.set(id, buf)
      return send(res, 200, 'image/png', buf, { 'cache-control': 'public, max-age=86400' })
    } catch { return send(res, 502, 'text/plain', 'upstream unavailable') }
  }

  if (path.endsWith('/')) path += 'index.html'
  if (path === '') path = '/index.html'

  try {
    const { body, etag } = await load(path)

    if (path === '/index.html') {
      const d = await data()
      if (!d) return send(res, 503, 'text/plain', 'warming up', { 'retry-after': '5' })
      const html = body.toString()
        .replace('__DATA__', () => JSON.stringify(d).replace(/</g, '\\u003c'))
        .replace(/"\.\/(main\.js|style\.css)"/g, `"./a/${BUILD}/$1"`)
      return send(res, 200, TYPES['.html'], html,
        { 'cache-control': 'public, max-age=60, must-revalidate' })
    }

    if (req.headers['if-none-match'] === etag) return send(res, 304, 'text/plain', '')
    const ext = extname(path)
    send(res, 200, TYPES[ext] || 'application/octet-stream',
      req.method === 'HEAD' ? undefined : body,
      { etag, 'cache-control': NO_CACHE ? 'no-store'
        : immutable ? 'public, max-age=31536000, immutable'
        : 'no-cache' })
  } catch {
    send(res, 404, 'text/plain', 'not found')
  }
}).listen(PORT, '0.0.0.0', () => console.log(`web on :${PORT} api=${API} build=${BUILD} bases=[${BASES}]`))
