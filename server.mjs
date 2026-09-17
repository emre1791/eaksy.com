import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join, normalize } from 'path'
import { createHash } from 'crypto'
import { Store } from './lib/store.mjs'

// ./public in the image (the Dockerfile copies src/ there); ./src from the repo
const ROOT = new URL(process.env.PUBLIC_DIR || './public/', import.meta.url).pathname
const PORT = Number(process.env.PORT || 8080)
const CACHE_DIR = process.env.CACHE_DIR || '/app/cache'
// paths this site may also be mounted under, e.g. apis.eaksy.com/eaksy/
const BASES = (process.env.BASE_PATHS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'))
const store = new Store({ config, dir: CACHE_DIR })

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}
// files are baked into the image and never change under it, so cache forever;
// NO_CACHE=1 turns that off when serving the repo directly during development
const NO_CACHE = process.env.NO_CACHE === '1'
const files = new Map()

async function load(p) {
  if (!NO_CACHE && files.has(p)) return files.get(p)
  const body = await readFile(join(ROOT, p))
  const entry = { body, etag: '"' + createHash('sha1').update(body).digest('base64url') + '"' }
  if (!NO_CACHE) files.set(p, entry)
  return entry
}

const send = (res, code, type, body, extra = {}) => {
  res.writeHead(code, {
    'content-type': type, 'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin', ...extra,
  })
  res.end(body)
}
const sendJson = (res, code, obj) =>
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj),
    { 'cache-control': 'public, max-age=300' })

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0]))
  if (path.includes('\0')) return send(res, 400, 'text/plain', 'bad request')

  // Serving under /eaksy means /eaksy (no slash) must bounce to /eaksy/, or the
  // browser resolves ./style.css against the parent and every asset 404s.
  for (const base of BASES) {
    if (path === base) { res.writeHead(301, { location: base + '/' }); return res.end() }
    if (path.startsWith(base + '/')) { path = path.slice(base.length); break }
  }

  if (path === '/healthz') return send(res, 200, 'text/plain', 'ok')

  /* ---- api: the only thing that knows roblox and github exist ---- */
  if (path.startsWith('/api/')) {
    const d = store.data
    if (!d) return sendJson(res, 503, { error: 'warming up' })
    const body = {
      '/api/data': () => d,
      '/api/games': () => ({ generated: d.generated, featured: d.featured, more: d.more, totalVisits: d.totalVisits }),
      '/api/github': () => ({ generated: d.generated, ...d.github }),
    }[path]
    return body ? sendJson(res, 200, body()) : sendJson(res, 404, { error: 'not found' })
  }

  /* ---- thumbnails, mirrored so visitors never call roblox ---- */
  if (path.startsWith('/img/')) {
    const id = path.slice(5).replace(/\.png$/, '')
    if (!/^\d+$/.test(id)) return send(res, 400, 'text/plain', 'bad request')
    try {
      const body = await readFile(join(CACHE_DIR, 'img', `${id}.png`))
      return send(res, 200, 'image/png', body, { 'cache-control': 'public, max-age=86400' })
    } catch { return send(res, 404, 'text/plain', 'not found') }
  }

  if (path.endsWith('/')) path += 'index.html'
  if (path === '') path = '/index.html'

  try {
    const { body, etag } = await load(path)

    // The page is handed its data inline, so it renders complete on first
    // paint — no client fetch, no spinner, no request to anyone but us.
    if (path === '/index.html') {
      const html = body.toString()
        .replace('__DATA__', () => JSON.stringify(store.data ?? null)
          .replace(/</g, '\\u003c'))
      return send(res, 200, TYPES['.html'], html,
        { 'cache-control': 'public, max-age=60, must-revalidate' })
    }

    if (req.headers['if-none-match'] === etag) return send(res, 304, 'text/plain', '')
    const ext = extname(path)
    send(res, 200, TYPES[ext] || 'application/octet-stream',
      req.method === 'HEAD' ? undefined : body,
      { etag, 'cache-control': NO_CACHE ? 'no-store' : 'public, max-age=3600' })
  } catch {
    send(res, 404, 'text/plain', 'not found')
  }
}).listen(PORT, '0.0.0.0', () => console.log(`serving ${ROOT} on :${PORT} bases=[${BASES}]`))

await store.start()
