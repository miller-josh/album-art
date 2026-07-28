# Album Cover Grid - implementation handoff

Browse album cover art filtered by decade and genre. MusicBrainz for metadata,
Cover Art Archive for images.

## Sources of truth

| Artifact | Authoritative for |
| --- | --- |
| `album-cover-grid-prd.md` | Functional spec, API contracts, compliance, acceptance criteria |
| `album-cover-grid-ui.html` | Interaction and visual design. Wins over PRD section 7 where they differ |
| This file | Decisions made after the PRD was written |

Read the PRD first. Do not re-derive it here.

## Target stack

Vite + React + TypeScript, deployed to Vercel with serverless functions for the
API layer. Confirm before scaffolding, since the PRD is framework-neutral and
the prototype is plain JS.

## Non-negotiable constraints

These come from PRD sections 11 and 25. Violating any of them is a bug, not a
tradeoff.

- The browser never calls MusicBrainz. All upstream traffic goes through this
  app's own API.
- Every MusicBrainz request carries a meaningful, contactable User-Agent.
- Never exceed one MusicBrainz request per second. Retries count against this.
- Query release groups, not individual releases.
- No per-card metadata requests. One search request per page of results.
- Cover Art Archive has no search endpoint. Do not invent one. Artwork URLs are
  constructed from release-group MBIDs.
- `front-500` in the grid, `front-1200` in the detail view. Never the original.
- Validate MBIDs as UUIDs before they reach an upstream path.
- Never present genre results as complete or authoritative.

## Decisions made after the PRD

| Decision | Detail | Status |
| --- | --- | --- |
| Genre accepts free text | Any typed value is valid and appears as the first option in the combobox. The 140-item seed list is a search aid, not a gate | Supersedes the curated-list combobox in PRD 7 |
| Decades are generated | From a single `EARLIEST_DECADE` constant, currently 1950, through the current decade | Supersedes the hardcoded list in PRD 7 |
| `/api/genres` also returns `decades` | So the allowed range has exactly one definition and the client does not keep a copy | Extends PRD 10.2 |
| `POST /api/cover-status` | Browser reports MBIDs whose artwork 404s, which is the only way to populate the negative cache | Implements the enhanced strategy in PRD 12 |
| Prototype-states bar | Scaffolding for reviewing loading, empty, and error states. Do not ship it | n/a |

## Already written and worth reusing

In `album-cover-grid/`. Plain CommonJS, zero dependencies, 34 passing tests.
The `lib/` modules are pure and framework-agnostic, so they port to serverless
functions with an import-syntax change and nothing else.

| Path | Does | Reuse |
| --- | --- | --- |
| `lib/lucene.js` | Reserved-character escaping, phrase quoting, genre normalization | Port as-is. The quoting rules are subtle, do not rewrite |
| `lib/query.js` | Decade to inclusive date range, query builder, cache keys | Port as-is |
| `lib/normalize.js` | Release group to AlbumCard, artist-credit join phrases, partial-date parsing | Port as-is |
| `lib/validate.js` | Filter and MBID validation, structured 400s | Port as-is |
| `lib/rate-limiter.js` | Serial queue, retries scheduled through the same queue | Reference only. Needs a shared store on Vercel |
| `lib/cache.js` | TTL caches including the negative cover cache | Reference only. Needs Redis |
| `test/run-tests.js` | Unit tests for all of the above | Port with the modules |
| `test/integration.js` | Routes, retry, caching, throttling against a stubbed upstream | Port the stubbing approach |

## Build order

Sections 1 through 6 of PRD 25 are effectively done in the reusable modules
above. Remaining:

1. Scaffold Vite + React + TS, port `lib/` into the API layer.
2. Swap the cache and rate limiter for Redis.
3. Rebuild the UI as components, matching `album-cover-grid-ui.html`. Component
   tree is in PRD 21.
4. Wire real data, then verify field names against a live response before
   trusting anything downstream.
5. End-to-end tests per PRD 24. None exist yet.
6. Accessibility and responsive review against PRD 16 and the acceptance
   criteria in PRD 23.

## Open risks

- **Nothing has run against the live API.** The upstream client is tested only
  against stubbed responses. Verify `first-release-date` and `artist-credit`
  join phrases against a real payload early, before building on their shape.
- **In-process cache and rate limiter.** On Vercel each instance would
  independently believe it is under the rate limit. This must be shared state
  before any multi-instance deploy.
- **Free-text genre can legitimately return zero results.** A typo and a real
  but untagged genre look identical. Consider validating against the live
  `/genre/all` list so a typo reads as a typo.
- **Tag coverage is uneven and thins out fast** for narrow genres and early
  decades. The backfill in PRD 12 and the two distinct empty states exist for
  this. Do not paper over it.

## Definition of done

PRD sections 23 and 28. Do not mark acceptance criteria complete without a test
covering them.
