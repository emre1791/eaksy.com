/* Cached snapshot of everything upstream, refreshed on a schedule.
 * Nothing here is ever fetched by a browser. */
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { fetchGithub, fetchRoblox } from './sources.mjs'

const REFRESH_HOUR_UTC = 1
const DAY = 86400e3

export class Store {
  constructor({ config, dir }) {
    this.cfg = config
    this.dir = dir
    this.file = join(dir, 'data.json')
    this.imgs = join(dir, 'img')
    this.data = null
    this.refreshing = null
  }

  async start() {
    await mkdir(this.imgs, { recursive: true })

    // a restart must not mean an empty page: serve whatever the last run left
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'))
      console.log(`cache: loaded snapshot from ${this.data.generated}`)
    } catch { console.log('cache: no snapshot on disk') }

    // A container that was down at 01:00 has a stale or missing snapshot.
    // Catch up now rather than waiting for the next window.
    if (this.stale()) await this.refresh().catch(e => console.error('cache: initial refresh failed:', e.message))
    else console.log('cache: snapshot is fresh, skipping boot fetch')

    this.schedule()
  }

  stale() {
    if (!this.data) return true
    return Date.now() - new Date(this.data.generated).getTime() > DAY
  }

  schedule() {
    const now = new Date()
    const next = new Date(now)
    next.setUTCHours(REFRESH_HOUR_UTC, 0, 0, 0)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    const wait = next - now
    console.log(`cache: next refresh ${next.toISOString()} (in ${(wait / 3600e3).toFixed(1)}h)`)
    // unref so a pending timer never holds the process open during shutdown
    setTimeout(() => {
      this.refresh().catch(e => console.error('cache: scheduled refresh failed:', e.message))
        .finally(() => this.schedule())
    }, wait).unref?.()
  }

  // collapse concurrent callers onto one in-flight fetch
  refresh() {
    if (!this.refreshing) {
      this.refreshing = this._refresh().finally(() => { this.refreshing = null })
    }
    return this.refreshing
  }

  async _refresh() {
    const t0 = Date.now()
    const [github, roblox] = await Promise.all([
      fetchGithub(this.cfg.github.user, this.cfg.github.since),
      fetchRoblox(this.cfg.roblox),
    ])

    const { sources, ...games } = roblox
    const next = { generated: new Date().toISOString(), github, ...games, map: this.cfg.map }

    await this.cacheImages(sources)
    this.data = next
    await writeFile(this.file, JSON.stringify(next)).catch(e =>
      console.error('cache: could not persist snapshot:', e.message))
    console.log(`cache: refreshed in ${Date.now() - t0}ms`)
    return next
  }

  /* Pull the thumbnails server-side so a visitor's browser never talks to
   * Roblox. A failed image must not fail the whole refresh. */
  async cacheImages(sources) {
    await Promise.all(Object.entries(sources).map(async ([id, url]) => {
      if (!url) return
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!r.ok) throw new Error(String(r.status))
        await writeFile(join(this.imgs, `${id}.png`), Buffer.from(await r.arrayBuffer()))
      } catch (e) { console.error(`cache: image ${id} failed: ${e.message}`) }
    }))
  }
}
