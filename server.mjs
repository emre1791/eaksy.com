import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join, normalize } from 'path'
import { createHash } from 'crypto'

// ./public in the image (the Dockerfile copies src/ there); ./src when run
// straight out of the repo
const ROOT = new URL(process.env.PUBLIC_DIR || './public/', import.meta.url).pathname
const PORT = Number(process.env.PORT || 8080)
// paths this site may also be mounted under, e.g. apis.eaksy.com/eaksy/
const BASES = (process.env.BASE_PATHS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}
// files are baked into the image and never change under it, so cache forever;
// NO_CACHE=1 turns that off when serving the repo directly during development
const NO_CACHE = process.env.NO_CACHE === '1'
const cache = new Map()

async function load(p) {
  if (!NO_CACHE && cache.has(p)) return cache.get(p)
  const body = await readFile(join(ROOT, p))
  const entry = { body, etag: '"' + createHash('sha1').update(body).digest('base64url') + '"' }
  if (!NO_CACHE) cache.set(p, entry)
  return entry
}

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split('?')[0]))
  if (path.includes('\0') || path.includes('..')) return end(res, 400, 'bad request')

  // Serving under /eaksy means /eaksy (no slash) must bounce to /eaksy/, or the
  // browser resolves ./style.css against the parent and every asset 404s.
  for (const base of BASES) {
    if (path === base) {
      res.writeHead(301, { location: base + '/' })
      return res.end()
    }
    if (path.startsWith(base + '/')) { path = path.slice(base.length); break }
  }

  if (path === '/healthz') return end(res, 200, 'ok')

  if (path.endsWith('/')) path += 'index.html'
  if (path === '') path = '/index.html'

  try {
    const { body, etag } = await load(path)
    if (req.headers['if-none-match'] === etag) return end(res, 304, '')
    const ext = extname(path)
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream',
      etag,
      // data.json and index.html are rewritten on every refresh; the rest is
      // content-addressed enough that a short cache is safe
      'cache-control': NO_CACHE ? 'no-store'
        : ext === '.html' || path === '/data.json'
          ? 'public, max-age=60, must-revalidate'
          : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    end(res, 404, 'not found')
  }
}).listen(PORT, '0.0.0.0', () => console.log(`serving ${ROOT} on :${PORT} bases=[${BASES}]`))

function end(res, code, msg) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(msg)
}
