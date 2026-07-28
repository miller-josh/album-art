# Album Cover Grid

A prototype of the PRD: a Pinterest-style browser for album cover art, filtered
by decade and genre. Metadata comes from MusicBrainz, images from the Cover Art
Archive.

Zero dependencies. Nothing to install, nothing to build.

## Run it

```bash
MB_CONTACT="https://your-site.example/contact" node server.js
# http://localhost:3000
```

`MB_CONTACT` goes into the MusicBrainz User-Agent. The server boots without it
and warns, but set it to something real before this leaves your machine.

```bash
npm test    # 34 tests, no network required
```

Try `http://localhost:3000/?decade=1970&genre=disco`.

## Why plain Node and plain JS

The PRD forbids calling MusicBrainz from the browser, so this needs a server,
which rules out a single-file artifact. Beyond that, keeping it dependency-free
means the prototype runs the moment you clone it and the interesting logic is
not buried under framework conventions. The Section 21 component tree maps onto
this almost one to one, so porting to Vite + React later is mechanical: the
`lib/` modules move to serverless functions unchanged, and `public/app.js`
splits along the boundaries already marked by comment banners.

## Layout

```
server.js              routing, static hosting, per-IP guard, error mapping
lib/config.js          decades, curated genres, TTLs, User-Agent, limits
lib/lucene.js          escaping and genre normalization
lib/query.js           decade to date range, query builder, cache keys
lib/musicbrainz.js     upstream client: UA, throttle, retry, timeout
lib/rate-limiter.js    serial queue enforcing one request per second
lib/cache.js           TTL caches, including the negative cover-art cache
lib/normalize.js       release group to AlbumCard / AlbumDetails
lib/validate.js        filter and MBID validation
public/                the browser app
test/                  unit + integration tests
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
  `lib/config.js` and the client reads it from there rather than keeping its own
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
- The browser never calls MusicBrainz. It only ever calls this server.
- One search request per page of 40 cards. No per-card metadata calls.
- Grid uses `front-500`, detail uses `front-1200`. Originals are never used.

## What is real and what is not

Implemented and tested: query building and escaping, validation, throttling,
retry, caching, normalization and dedupe, the negative cover cache, error
mapping, the grid, URL state, the combobox, infinite scroll with a `Load more`
fallback, thin-coverage backfill, the detail modal, and the empty/degraded/error
states.

Not done, and worth knowing before you demo it:

- **The caches are in-process.** Fine for one machine. A multi-instance deploy
  needs Redis for both the cache and the rate limiter, or each instance will
  independently believe it is under the limit. `lib/cache.js` and
  `lib/rate-limiter.js` are isolated so this is a swap, not a rewrite.
- **No live API run yet.** I had no network access while building this, so the
  upstream client is exercised against stubbed MusicBrainz responses covering
  success, 503-then-success, exhausted retries, and malformed bodies. The shapes
  follow the documented API, but the first real run is still the first real run.
  Field naming is the likeliest thing to bite: check `first-release-date` and
  `artist-credit` join phrases against a live response early.
- **No end-to-end browser tests.** The Section 24 e2e list is unwritten. The
  unit and integration layers are done.
- **Genre coverage is uneven** and that is upstream, not a bug here. Disco in
  the 1970s is well tagged. Narrow genre plus early decade gets thin fast, which
  is what the backfill and the two distinct empty states are for.

## Design

The chrome is achromatic on purpose: the only color on the page should come from
the artwork. Catalog data (years, counts, MBIDs) is set in mono, and the active
filter renders as a divider card standing up in a record bin, which is the one
piece of personality in the interface. Sleeves have square corners and a hairline
edge. Hover lifts a cover slightly, like pulling a record forward in a bin.
Reduced motion removes all of it.
