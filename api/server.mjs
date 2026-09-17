/* The only process that knows github and roblox exist.
 * Mounted at a path prefix (apis.eaksy.com/eaksy/), so every route is
 * resolved after that prefix is stripped. */
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { Store } from './lib/store.mjs'

const PORT = Number(process.env.PORT || 8080)
const CACHE_DIR = process.env.CACHE_DIR || '/app/cache'
const BASES = (process.env.BASE_PATHS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'))
const store = new Store({ config, dir: CACHE_DIR })

const send = (res, code, type, body, extra = {}) => {
  res.writeHead(code, {
    'content-type': type, 'x-content-type-options': 'nosniff', ...extra,
  })
  res.end(body)
}
const json = (res, code, obj, maxAge = 300) =>
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj),
    { 'cache-control': `public, max-age=${maxAge}` })

const ROUTES = {
  '/': d => ({
    generated: d.generated,
    endpoints: ['/data', '/games', '/github', '/img/{universeId}.png'],
  }),
  '/data': d => d,
  '/games': d => ({ generated: d.generated, featured: d.featured, more: d.more, totalVisits: d.totalVisits }),
  '/github': d => ({ generated: d.generated, ...d.github }),
}

createServer(async (req, res) => {
  let path = new URL(req.url, 'http://x').pathname
  if (path.includes('\0')) return send(res, 400, 'text/plain', 'bad request')

  // /eaksy must bounce to /eaksy/ so relative clients resolve consistently
  for (const base of BASES) {
    if (path === base) { res.writeHead(301, { location: base + '/' }); return res.end() }
    if (path.startsWith(base + '/')) { path = path.slice(base.length); break }
  }
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  if (path === '/healthz') return send(res, 200, 'text/plain', 'ok')

  if (path.startsWith('/img/')) {
    const id = path.slice(5).replace(/\.png$/, '')
    if (!/^\d+$/.test(id)) return send(res, 400, 'text/plain', 'bad request')
    try {
      const body = await readFile(join(CACHE_DIR, 'img', `${id}.png`))
      return send(res, 200, 'image/png', body, { 'cache-control': 'public, max-age=86400' })
    } catch { return send(res, 404, 'text/plain', 'not found') }
  }

  const route = ROUTES[path]
  if (!route) return json(res, 404, { error: 'not found' })
  if (!store.data) return json(res, 503, { error: 'warming up' }, 0)
  json(res, 200, route(store.data))
}).listen(PORT, '0.0.0.0', () => console.log(`api on :${PORT} bases=[${BASES}]`))

await store.start()
