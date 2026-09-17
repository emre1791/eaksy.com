import * as si from 'simple-icons'
import { writeFileSync, readFileSync } from 'fs'

// only things that actually appear in the repos, or that Emre named directly
const SLUGS = [
  'typescript','go','lua','python','php','nodedotjs',
  'roblox','react','vite','nx','expo','flutter','tauri',
  'docker','kubernetes','traefikproxy','tailscale','githubactions',
  'googlecloud','googlebigquery','firebase','cloudflare',
  'grafana','prometheus','postgresql','algolia',
  'raspberrypi','balena','gstreamer','linux','webrtc',
]
// no mark in the icon set — rendered as a label-only chip rather than a fake logo
// balena has no simple-icons entry; this is their own mark, flattened from the
// official wordmark SVG and refitted to a 24x24 box
const CUSTOM = {
  balena: { t: 'balena', svg: readFileSync(new URL('./balena.svg', import.meta.url), 'utf8')
    .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '') },
}
const key = s => 'si' + s[0].toUpperCase() + s.slice(1)
const out = SLUGS.map(s => {
  if (CUSTOM[s]) return CUSTOM[s]
  const i = si[key(s)]
  if (!i) throw new Error('missing icon: ' + s)
  return { t: (i.title === 'Traefik Proxy' ? 'Traefik' : i.title), p: i.path }
})
writeFileSync('/home/agent/site/src/tech.js', `export const TECH=${JSON.stringify(out)};\n`)
console.log('chips', out.length)
