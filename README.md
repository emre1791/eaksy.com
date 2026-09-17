# eaksy.com

My site. One page, no framework — plain HTML, one stylesheet, and a handful of
ES modules.

Two processes:

    api/   apis.eaksy.com/eaksy/   fetches github + roblox, caches, serves json
    web/   eaksy.com               the page; asks api, knows nothing upstream

## How it works

A visitor's browser only ever talks to the host it loaded. It makes no request
to github or roblox — not for data, and not for images.

`api` refreshes on boot and again nightly at 01:00 UTC, keeping the snapshot on
disk. A restart reuses it; a container that was down at 01:00 notices the
snapshot is over a day old and catches up immediately.

`web` asks `api` for that snapshot server-side and inlines it into the page, so
the HTML arrives complete — no client fetch, no spinner. If `api` is
unreachable, `web` keeps serving the last payload it saw rather than a blank
page, and mirrors the thumbnails in memory for the same reason.

Build-time asset generation lives in `web/build`:

- `genmap.mjs` — samples Natural Earth land polygons into a lon/lat bitmask, so
  the background map ships as a string instead of a mapping library.
- `gentech.mjs` — bakes the stack icons into a module.

### GitHub contributions

Scraped from the public profile fragment, which needs no token — a PAT has no
business in an internet-facing container. Two traps: that endpoint silently
snaps `?from=` to the calendar year containing the date, and GitHub's own
"last 12 months" is week-aligned (it starts on the Sunday on or before
today-52w, so it spans 365-371 days, not 365).

### Roblox visits

The per-universe endpoint returns `[TITLE UNAVAILABLE]` whenever the calling IP
can't play the game (`ContextualPlayabilityRegionalCompliance`), which is most
of them from a European server. The group listing has no such check, so games
resolve through their owning group and only fall back to the universe endpoint.

## Serving

Both servers can be mounted under a path prefix (`BASE_PATHS=/eaksy`), which is
how the api lives at `apis.eaksy.com/eaksy/` with no `StripPrefix` middleware —
and without the trailing-slash bug where `/eaksy` resolves `./style.css`
against the parent and 404s every asset.

## Running it

    node web/build/genmap.mjs
    node web/build/gentech.mjs

    BASE_PATHS=/eaksy CACHE_DIR=/tmp/eaksy node api/server.mjs   # :8080
    PORT=8081 API_ORIGIN=http://127.0.0.1:8080/eaksy \
      PUBLIC_DIR=./public/ node web/server.mjs                   # :8081

`./deploy.sh` builds and pushes both images, then updates the stack.

## Licence

Code is MIT (`LICENSE`). Personal content, and the brand marks the stack row
uses for identification, are not — see `NOTICE`.
