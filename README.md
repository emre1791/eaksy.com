# eaksy.com

My site. One page, no framework — plain HTML, one stylesheet, and a handful of
ES modules.

## How it works

Nothing is fetched in the browser. A build step pulls the numbers once and
writes `src/data.json`, which the page imports:

- `build/fetchdata.mjs` — GitHub contributions (per calendar year, plus the
  rolling 12-month window GitHub shows by default) and Roblox visit counts.
- `build/genmap.mjs` — samples Natural Earth land polygons into a lon/lat
  bitmask, so the background map ships as a string instead of a mapping library.
- `build/gentech.mjs` — bakes the stack icons into a module.

That means no API keys in the client, no CORS, no rate limits, and no spinners.

### Roblox visits

The per-universe endpoint returns `[TITLE UNAVAILABLE]` whenever the calling IP
can't play the game (`ContextualPlayabilityRegionalCompliance`), which is most
of them from a European server. The group listing has no such check, so games
resolve through their owning group and only fall back to the universe endpoint.

## Serving

`server.mjs` is a static server with one extra job: it can be mounted under a
path prefix (`BASE_PATHS=/eaksy`), so the same container answers on both the
apex and a sub-path of another host without a `StripPrefix` middleware — and
without the trailing-slash bug where `/eaksy` resolves `./style.css` against the
parent and 404s every asset.

## Running it

    node build/genmap.mjs
    node build/gentech.mjs
    node build/fetchdata.mjs   # needs the gh CLI, authenticated
    PUBLIC_DIR=./src/ node server.mjs   # http://localhost:8080

`./deploy.sh` does the same, then builds the image and updates the service.
