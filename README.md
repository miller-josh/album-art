# Album Cover Grid

A Pinterest-style browser for album cover art, filtered by decade and genre.
Metadata comes from MusicBrainz, images from the Cover Art Archive.

Stack: **Vite + React + TypeScript** for the frontend, **Vercel serverless
functions** (`api/`) for the API layer that fronts MusicBrainz. The pure query,
validation, normalization, throttling and caching logic lives in `lib/` and is
shared by both.

## Run it locally

```bash
npm install

# Terminal 1 — the API layer (serverless handlers under a local Node harness)
MB_CONTACT="https://your-site.example/contact" npm run dev:api   # :3000

# Terminal 2 — the Vite dev server, which proxies /api to :3000
npm run dev                                                       # :5173
```

`MB_CONTACT` goes into the MusicBrainz User-Agent. The server boots without it
and warns, but set it to something real before this leaves your machine.

```bash
npm test         # 33 unit + integration tests, no network required
npm run typecheck
npm run build    # production frontend build (dist/)
```

## Deploying

Zero-config on Vercel: it detects Vite for the frontend (`dist/`) and serves the
`api/*.ts` files as Node serverless functions. Set `MB_CONTACT` as an
environment variable in the Vercel project.

## Layout

```
index.html             Vite entry
vite.config.ts         frontend build + /api dev proxy
dev-server.ts          local Node harness that routes to the api/ handlers
src/                   React app (App, api client, styles)
api/                   Vercel serverless functions
  albums.ts              GET  /api/albums
  albums/[mbid].ts       GET  /api/albums/:mbid
  genres.ts              GET  /api/genres
  cover-status.ts        POST /api/cover-status
  _http.ts               shared JSON/error helpers + per-IP guard
lib/                   pure, framework-agnostic modules (shared by api + tests)
  config.ts              decades, curated genres, TTLs, User-Agent, limits
  lucene.ts              escaping and genre normalization
  query.ts               decade to date range, query builder, cache keys
  musicbrainz.ts         upstream client: UA, throttle, retry, timeout
  rate-limiter.ts        serial queue enforcing one request per second
  cache.ts               TTL caches, including the negative cover-art cache
  normalize.ts           release group to AlbumCard / AlbumDetails
  validate.ts            filter and MBID validation
  types.ts               shared response/domain types
test/                  unit + integration tests (run via node --test + tsx)
```

## API

| Endpoint | Notes |
| --- | --- |
| `GET /api/albums?decade=&genre=&offset=&limit=` | Search. Validated, cached 24h |
| `GET /api/albums/:mbid` | Detail with genres. Cached 7d, MBID validated as a UUID |
| `GET /api/genres` | MusicBrainz genre list, falls back to the curated list |
| `POST /api/cover-status` | Browser reports MBIDs whose artwork 404'd |

Two small deviations from the spec, both deliberate:

- `/api/genres` also returns `decades`. The PRD requires that adding earlier
  decades not duplicate code, so the allowed range is defined once in
  `lib/config.ts` and the client reads it from there rather than keeping its own
  copy. To add the 1940s, change `EARLIEST_DECADE`. Nothing else moves.
- `POST /api/cover-status` is not in the PRD. It is how the "preferred enhanced
  strategy" negative cache in Section 12 gets populated, since only the browser
  finds out that a cover is missing. It accepts validated UUIDs only, caps each
  batch at 100, and stores a boolean, so it cannot be used as a proxy.

## Compliance notes

- Every upstream call passes through one shared serial queue with 1100ms
  spacing. Retries are queued through the same limiter, so backoff can never
  push the app over the rate limit.
- Retries are capped at 3 attempts for 429/5xx and network failures. 400 and
  404 are not retried.
- The browser never calls MusicBrainz. It only ever calls this app's API.
- One search request per page of 40 cards. No per-card metadata calls.
- Grid uses `front-500`, detail uses `front-1200`. Originals are never used.

## What is real and what is not

Done: the `lib/` logic (query building, escaping, validation, throttling,
retry, caching, normalization and dedupe, the negative cover cache, error
mapping) is fully ported to TypeScript and covered by the test suite; the
serverless API layer wraps it; a working React frontend loads decades/genres,
holds filter state in the URL, renders the grid with lazy images, hides and
reports covers that 404, and paginates with a `Load more` control.

Not done yet, in build order:

- **The in-process cache and rate limiter are per-instance.** On Vercel each
  function instance would independently believe it is under the rate limit.
  This must move to a shared store (Redis) before any multi-instance deploy.
  `lib/cache.ts` and `lib/rate-limiter.ts` are isolated so this is a swap.
- **The frontend is a functional scaffold, not the final design.** The full
  component tree, the album detail modal with focus trapping, the visual system
  from `album-cover-grid-ui.html`, and the accessibility pass (PRD 16) are still
  to come.
- **No end-to-end browser tests.** The PRD Section 24 e2e list is unwritten. The
  unit and integration layers are done.
- **Nothing has run against the live API.** The upstream client is exercised
  only against stubbed responses. Verify `first-release-date` and
  `artist-credit` join phrases against a real payload early — a network policy
  may block MusicBrainz in CI/sandbox environments.
