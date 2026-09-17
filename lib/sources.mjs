/* Upstream fetchers. These run in the container, never in the browser. */

async function json(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (r.ok) return r.json()
    // roblox throttles bursts; a cold 429 would silently drop a game
    if (i === tries - 1) throw new Error(`${r.status} ${url}`)
    await new Promise(res => setTimeout(res, 600 * 2 ** i))
  }
}

/* ---------------- github ----------------
 * The public contributions fragment carries exact per-day counts in its
 * tool-tips, so this needs no token — which matters, because a PAT has no
 * business living in an internet-facing container.
 */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december']

// NOTE: this endpoint snaps to the calendar year containing `from` — an
// arbitrary date range is silently widened, so only ask it for whole years
// and compose any other window from the results.
async function contributions(user, year) {
  const r = await fetch(
    `https://github.com/users/${encodeURIComponent(user)}/contributions?from=${year}-01-01`,
    { headers: { 'x-requested-with': 'XMLHttpRequest' }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`github ${r.status}`)
  const html = await r.text()

  // tool-tip text is the only place the exact number appears; data-level is a bucket
  const counts = new Map()
  for (const m of html.matchAll(/for="([^"]+)"[^>]*>(?:(No)|(\d+))\s+contributions?\s+on\s+(\w+)\s+(\d+)/g)) {
    counts.set(m[1], m[2] ? 0 : +m[3])
  }

  const days = []
  for (const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"\s+id="([^"]+)"/g)) {
    days.push({ date: m[1], count: counts.get(m[2]) ?? 0 })
  }
  days.sort((a, b) => a.date.localeCompare(b.date))
  if (!days.length) throw new Error('github: no days parsed')
  return days
}

const pack = days => ({
  total: days.reduce((s, d) => s + d.count, 0),
  from: days[0].date,
  // the first day is rarely a Sunday; the client pads so weekdays stay in rows
  pad: new Date(days[0].date + 'T00:00:00Z').getUTCDay(),
  days: days.map(d => d.count),
})

export async function fetchGithub(user, since) {
  const now = new Date()
  const thisYear = now.getUTCFullYear()
  const today = now.toISOString().slice(0, 10)

  const byYear = new Map()
  for (let y = since; y <= thisYear; y++) {
    byYear.set(y, (await contributions(user, y)).filter(d => d.date <= today))
  }

  // github's default view is a trailing 12 months built out of whole weeks: it
  // starts on the Sunday on or before today-52w, so it runs 365-371 days. Cut
  // to the exact day instead and the first partial week goes missing.
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - 364)
  cutoff.setUTCDate(cutoff.getUTCDate() - cutoff.getUTCDay())
  const from = cutoff.toISOString().slice(0, 10)
  const rolling = [...(byYear.get(thisYear - 1) || []), ...(byYear.get(thisYear) || [])]
    .filter(d => d.date >= from)

  const years = {}
  const order = []
  if (rolling.length) years.rolling = pack(rolling)
  for (const [y, days] of byYear) {
    if (!days.length || !days.some(d => d.count)) continue
    years[y] = pack(days)
    order.push(y)
  }
  order.sort((a, b) => b - a)

  return {
    years,
    options: [{ v: 'rolling', label: 'the last 12 months' },
      ...order.map(y => ({ v: String(y), label: String(y) }))],
  }
}

/* ---------------- roblox ----------------
 * The per-universe endpoint returns [TITLE UNAVAILABLE] whenever the caller's
 * IP can't play the game (ContextualPlayabilityRegionalCompliance), which is
 * most of them from a European host. Group listings have no such check.
 */
const groups = new Map()
async function fromGroup(groupId, universeId) {
  if (!groups.has(groupId)) {
    const r = await json(`https://games.roblox.com/v2/groups/${groupId}/gamesV2?accessFilter=Public&limit=100`)
    if (!r.data?.length) throw new Error(`group ${groupId} returned no games`)
    groups.set(groupId, new Map(r.data.map(g => [g.id, g])))
  }
  return groups.get(groupId).get(universeId)
}

// roblox titles are full of decoration that reads as clutter next to the serif
const clean = s => s
  .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
  .replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()

async function resolve({ u, g }) {
  const hit = g ? await fromGroup(g, u) : null
  if (hit) return { name: clean(hit.name), visits: hit.placeVisits, place: hit.rootPlace.id }
  const r = (await json(`https://games.roblox.com/v1/games?universeIds=${u}`)).data?.[0]
  if (!r || r.name === '[TITLE UNAVAILABLE]') throw new Error(`no public data for universe ${u}`)
  return { name: clean(r.name), visits: r.visits, place: r.rootPlaceId }
}

export async function fetchRoblox(cfg) {
  groups.clear()
  const ids = [...cfg.featured, ...cfg.more].map(x => x.u)
  const t = await json(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids.join(',')}&size=768x432&format=Png&isCircular=false`)
  const thumbs = new Map((t.data || []).map(d => [d.universeId, d.thumbnails?.[0]?.imageUrl || null]))

  const featured = []
  for (const e of cfg.featured) {
    const r = await resolve(e)
    featured.push({ id: e.u, name: r.name, visits: r.visits,
      url: `https://www.roblox.com/games/${r.place}/` })
  }
  const more = []
  for (const e of cfg.more) {
    const r = await resolve(e)
    more.push({ id: e.u, name: r.name, visits: r.visits })
  }
  more.sort((a, b) => b.visits - a.visits)

  return {
    featured,
    more: { count: more.length, visits: more.reduce((s, g) => s + g.visits, 0),
      ids: more.slice(0, 4).map(g => g.id) },
    totalVisits: [...featured, ...more].reduce((s, g) => s + g.visits, 0),
    // kept server-side only: the browser is never told a roblox image URL
    sources: Object.fromEntries([...featured, ...more]
      .map(g => [g.id, thumbs.get(g.id)]).filter(([, u]) => u)),
  }
}
