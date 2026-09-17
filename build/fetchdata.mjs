import { execFileSync } from 'child_process'
import { writeFileSync, readFileSync } from 'fs'

const CFG = JSON.parse(readFileSync('/home/agent/site/config.json', 'utf8'))
// roblox throttles bursts; a cold 429 here would silently drop a game
async function j(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url)
    if (r.ok) return r.json()
    if (i === tries - 1) throw new Error(`${r.status} ${url}`)
    await new Promise(res => setTimeout(res, 600 * 2 ** i))
  }
}

/* ---------- github ---------- */
const gql = q => JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${q}`]).toString()).data

const createdAt = new Date(gql(`{user(login:"${CFG.github}"){createdAt}}`).user.createdAt)
const now = new Date()
const YEARS = []
for (let y = createdAt.getUTCFullYear(); y <= now.getUTCFullYear(); y++) YEARS.push(y)

// contributionsCollection caps at one year per call, so ask year by year
const years = {}
for (const y of YEARS) {
  const from = `${y}-01-01T00:00:00Z`
  const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`
  const cal = gql(`{user(login:"${CFG.github}"){contributionsCollection(from:"${from}",to:"${to}"){
    contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`)
    .user.contributionsCollection.contributionCalendar
  const days = cal.weeks.flatMap(w => w.contributionDays)
  if (!days.length) continue
  years[y] = {
    total: cal.totalContributions,
    from: days[0].date,
    // first column starts mid-week; the client pads so weekdays stay in rows
    pad: days[0].weekday,
    days: days.map(d => d.contributionCount),
  }
}
// no from/to = github's own default rolling window, the one you get when you
// land on a profile without picking a year
const roll = gql(`{user(login:"${CFG.github}"){contributionsCollection{
  contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`)
  .user.contributionsCollection.contributionCalendar
const rollDays = roll.weeks.flatMap(w => w.contributionDays)
years.rolling = {
  total: roll.totalContributions,
  from: rollDays[0].date,
  pad: rollDays[0].weekday,
  days: rollDays.map(d => d.contributionCount),
}

const yearKeys = Object.keys(years)
  .filter(k => k !== 'rolling' && years[k].total > 0)
  .map(Number).sort((a, b) => b - a)

/* ---------- roblox ----------
 * The per-universe games endpoint returns [TITLE UNAVAILABLE] whenever the
 * caller's IP can't play the game (ContextualPlayabilityRegionalCompliance),
 * which is most of them from a Belgian VM. The group listing has no such
 * check, so resolve through the owning group and only fall back to the
 * universe endpoint for games whose owner we don't know.
 */
const groupCache = new Map()
async function groupGames(groupId) {
  if (!groupCache.has(groupId)) {
    const r = await j(`https://games.roblox.com/v2/groups/${groupId}/gamesV2?accessFilter=Public&limit=100`)
    if (!r.data?.length) throw new Error(`group ${groupId} returned no games`)
    groupCache.set(groupId, new Map(r.data.map(g => [g.id, g])))
  }
  return groupCache.get(groupId)
}

async function resolve({ u, g }) {
  const fromGroup = g ? (await groupGames(g)).get(u) : null
  if (fromGroup) return { name: fromGroup.name, visits: fromGroup.placeVisits, place: fromGroup.rootPlace.id }
  const r = (await j(`https://games.roblox.com/v1/games?universeIds=${u}`)).data?.[0]
  if (!r || r.name === '[TITLE UNAVAILABLE]') throw new Error(`no public data for universe ${u}`)
  return { name: r.name, visits: r.visits, place: r.rootPlaceId }
}

async function thumbs(ids) {
  const r = await j(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids.join(',')}&size=768x432&format=Png&isCircular=false`)
  return new Map((r.data || []).map(d => [d.universeId, d.thumbnails?.[0]?.imageUrl || null]))
}

// strip the emoji/decoration Roblox titles are full of — it reads as clutter
const clean = s => s
  .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
  .replace(/\[[^\]]*\]/g, '')
  .replace(/\s+/g, ' ').trim()

const allIds = [...CFG.roblox.featured, ...CFG.roblox.more].map(x => x.u)
const th = await thumbs(allIds)

const featured = []
for (const e of CFG.roblox.featured) {
  const r = await resolve(e)
  featured.push({ name: clean(r.name), visits: r.visits, thumb: th.get(e.u),
                  url: `https://www.roblox.com/games/${r.place}/` })
}
const more = []
for (const e of CFG.roblox.more) {
  const r = await resolve(e)
  more.push({ name: clean(r.name), visits: r.visits, thumb: th.get(e.u) })
}
more.sort((a, b) => b.visits - a.visits)

const out = {
  generated: new Date().toISOString(),
  github: {
    user: CFG.github,
    years,
    options: [
      { v: 'rolling', label: 'the last 12 months' },
      ...yearKeys.map(y => ({ v: String(y), label: String(y) })),
    ],
  },
  featured,
  more: {
    count: more.length,
    visits: more.reduce((s, g) => s + g.visits, 0),
    thumbs: more.slice(0, 4).map(g => g.thumb),
  },
  totalVisits: [...featured, ...more].reduce((s, g) => s + g.visits, 0),
  map: CFG.map,
}
writeFileSync('/home/agent/site/src/data.json', JSON.stringify(out))
console.log('years', yearKeys.join(','), '| rolling', years.rolling.total,
  '| featured', featured.map(g => g.name).join(', '),
  '| more', out.more.count, out.more.visits.toLocaleString('en-US'),
  '| total', out.totalVisits.toLocaleString('en-US'))
