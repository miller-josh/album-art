# Product Requirements Document: Album Cover Grid

**Working title:** Album Cover Grid  
**Document status:** MVP specification  
**Primary experience:** Pinterest-inspired visual browser for record album covers  
**Primary data sources:** MusicBrainz API + Cover Art Archive API

---

## 1. Product Summary

Build a fast, visually focused web application that displays a responsive grid of album covers. Users can filter the gallery by **decade** and **genre**, then continuously browse matching album artwork.

The application must use:

- **MusicBrainz** for album metadata, release dates, genre/tag matching, artist names, album titles, and MusicBrainz IDs.
- **Cover Art Archive** for cover images.

### Important architecture constraint

Cover Art Archive does **not** provide a general discovery API for filtering albums by decade or genre. It retrieves artwork using a MusicBrainz release or release-group MBID. Therefore:

1. Search MusicBrainz for matching **release groups**.
2. Extract each release-group MBID.
3. Construct a Cover Art Archive URL for the canonical front cover.
4. Display only results that have usable cover art.

Use **release groups**, rather than individual releases, to avoid showing multiple editions, countries, remasters, CDs, and vinyl pressings of the same album as separate cards.

---

## 2. Product Goal

Help users rapidly explore album-cover design from a particular musical period and genre without navigating traditional music-database pages.

The primary product value is **visual discovery**, not music playback, collecting, reviews, or discography management.

### Example use case

A user chooses:

- Decade: `1970s`
- Genre: `Disco`

The application displays a dense, scrollable grid of front covers for MusicBrainz release groups whose earliest release date falls between January 1, 1970 and December 31, 1979 and which are tagged with disco-related metadata.

---

## 3. MVP Scope

### Required

- Responsive album-cover grid.
- Decade filter.
- Genre filter.
- Album title, artist, and year metadata.
- Infinite scroll or a clear “Load more” interaction.
- Album details modal or drawer.
- Direct links to the corresponding MusicBrainz page.
- Graceful handling of releases without cover art.
- Server-side MusicBrainz requests with compliant identification, throttling, retries, and caching.
- URL-based filter state so filtered views can be bookmarked or shared.
- Loading, empty, degraded, and error states.

### Optional for MVP

- Text search for album or artist.
- Sort options.
- Release-type selector.
- Favorite/save button stored locally in the browser.
- Dark mode.

### Explicitly out of scope for MVP

- Audio playback.
- User accounts.
- Social feeds or comments.
- Uploading album covers.
- Editing MusicBrainz data.
- Downloading collections in bulk.
- Shopping links.
- Spotify, Apple Music, Discogs, or Last.fm integration.
- AI-generated cover art.

---

## 4. Target Users

### Primary user

A designer, music fan, record collector, or creative researcher who wants to visually browse album artwork from a specific era and genre.

### User needs

- See many covers quickly.
- Change decades or genres with minimal friction.
- Avoid duplicate editions.
- Open a larger image when a cover is interesting.
- Identify the album and artist without overwhelming the artwork.
- Share or revisit a particular filtered view.

---

## 5. Core User Stories

1. As a user, I can select a decade so I only see albums first released during that decade.
2. As a user, I can select a genre so the results are relevant to the musical style I am researching.
3. As a user, I can combine decade and genre filters.
4. As a user, I can scroll through many covers without manually opening database pages.
5. As a user, I can see the artist, album title, and first-release year for a cover.
6. As a user, I can click a cover to view a larger image and more metadata.
7. As a user, I can open the source album on MusicBrainz.
8. As a user, I receive a useful message when no matching covers are available.
9. As a user, I can reload or share the page without losing the active filters.

---

## 6. Information Architecture

### Main gallery page

The main page contains:

1. Header and product title.
2. Filter controls.
3. Active-filter summary and result count when available.
4. Responsive cover grid.
5. Pagination/loading control.
6. Footer with source attribution and rights notice.

### Album detail view

Open as a modal on desktop and a bottom sheet or full-screen panel on mobile.

Display:

- 1200px cover image when available.
- Album title.
- Artist credit.
- First-release date or year.
- Primary release-group type.
- Selected/matched genre.
- Additional MusicBrainz genres when they have been fetched.
- Button or link: `View on MusicBrainz`.
- MusicBrainz release-group MBID in a secondary technical section, not as prominent UI.

---

## 7. UX and Visual Requirements

### Visual direction

- Artwork must dominate the interface.
- Use a clean, neutral visual system that does not compete with cover colors.
- The gallery should feel similar to Pinterest or a visual mood board.
- Avoid database-like tables.
- Use generous spacing but keep enough density to support scanning.

### Grid behavior

Because most album covers are approximately square, use a responsive CSS grid rather than forcing a traditional uneven masonry layout.

Recommended columns:

- Small mobile: 2 columns.
- Large mobile/small tablet: 3 columns.
- Tablet: 4 columns.
- Laptop: 5–6 columns.
- Large desktop: 7–9 columns, constrained by a maximum card width.

Each card should include:

- Square image container using `aspect-ratio: 1 / 1`.
- Album title beneath the image, limited to two lines.
- Artist name, limited to one line.
- First-release year.
- Hover/focus affordance.

### Image behavior

- Grid image size: use the Cover Art Archive 500px thumbnail.
- Detail image size: use the 1200px thumbnail.
- Use native lazy loading.
- Reserve image dimensions before loading to prevent layout shift.
- Use a subtle skeleton while loading.
- If a cover URL returns an error, remove the card or replace it with a consistent unavailable state according to the behavior in Section 12.
- Do not stretch images.

### Filter controls

#### Decade

Use a single-select control with these initial values:

- 1950s
- 1960s
- 1970s
- 1980s
- 1990s
- 2000s
- 2010s
- 2020s

Architecture must allow earlier decades to be added without code duplication.

Represent a decade internally by its starting year. For example:

```ts
1970
```

Convert it to an inclusive date range:

```text
1970-01-01 through 1979-12-31
```

#### Genre

Use a searchable single-select combobox.

For the first load, populate genres from a curated list of recognizable options, such as:

- Alternative rock
- Blues
- Country
- Disco
- Electronic
- Folk
- Funk
- Hip hop
- Jazz
- Metal
- New wave
- Pop
- Punk
- R&B
- Reggae
- Rock
- Soul

Also implement a server-side genre-list endpoint based on MusicBrainz `/genre/all` so the curated list can later be replaced or expanded.

Genre values sent to MusicBrainz must be normalized to lowercase and safely escaped for Lucene query syntax. Multiword values must be quoted.

### URL state

The active filters must be represented in the URL:

```text
/?decade=1970&genre=disco
```

Changing a filter should update the URL without a full-page refresh.

Browser back and forward navigation must restore previous filter combinations.

---

## 8. Data Sources

## 8.1 MusicBrainz API

Base URL:

```text
https://musicbrainz.org/ws/2/
```

Use the `release-group` search resource because a release group represents the conceptual album and consolidates its editions.

### Required MusicBrainz fields

From release-group search results, normalize:

- `id`
- `title`
- `first-release-date`
- `primary-type`
- `secondary-types`, when supplied
- `artist-credit`
- search `score`

### Genre behavior

MusicBrainz genres are implemented through its tagging system. Release-group search supports a `tag` search field. The selected genre should therefore be translated into a `tag:` clause.

Genre/tag coverage is community-maintained and may be incomplete. The UI must not imply that results are exhaustive.

### Date behavior

Use the release group's `firstreleasedate` search field. This represents the earliest release date associated with the conceptual album.

If a returned date is incomplete, such as `1977` or `1977-05`, parse the available year and treat it as valid when the year belongs to the selected decade.

---

## 8.2 Cover Art Archive API

Base URL:

```text
https://coverartarchive.org/
```

For a release-group MBID:

```text
https://coverartarchive.org/release-group/{RELEASE_GROUP_MBID}/front-500
```

Use for detail view:

```text
https://coverartarchive.org/release-group/{RELEASE_GROUP_MBID}/front-1200
```

Optional metadata endpoint:

```text
https://coverartarchive.org/release-group/{RELEASE_GROUP_MBID}/
```

The image endpoints commonly respond with an HTTP redirect to an Internet Archive-hosted image. The client must follow redirects.

Expected behavior:

- `307`: artwork exists and the request redirects to the image.
- `404`: no selected front image exists for the release group.
- `503`: temporary service/rate error; retry according to the retry policy.

Do not use the original full-resolution image in the grid.

---

## 9. MusicBrainz Query Construction

### Default query

For decade `1970`, genre `disco`, and album release groups:

```text
firstreleasedate:[1970-01-01 TO 1979-12-31]
AND tag:"disco"
AND primarytype:album
AND status:official
```

URL-encode the complete query before placing it in the request.

Example request shape:

```text
GET https://musicbrainz.org/ws/2/release-group/
  ?query={URL_ENCODED_LUCENE_QUERY}
  &fmt=json
  &limit=40
  &offset=0
```

The actual HTTP request must be a normal single-line URL.

### Query builder rules

1. Never concatenate unescaped raw user input into a Lucene query.
2. Convert decade start year to exact inclusive start and end dates.
3. Quote genre terms.
4. Escape Lucene reserved characters.
5. Include `primarytype:album` in MVP.
6. Include `status:official` by default.
7. Limit each MusicBrainz search request to 40 results for the UI, even though the API permits up to 100.
8. Use `offset` for pagination.
9. Reject invalid decade values server-side.
10. Reject genres longer than 80 characters.

### Optional text search

When implemented, append a safely escaped clause matching album or artist text. Do not allow the text query to replace the decade and genre restrictions.

---

## 10. Application API

All MusicBrainz calls must be made through the application's backend or server-side API layer. Do not call MusicBrainz directly from every browser client.

Reasons:

- Set a meaningful User-Agent reliably.
- Enforce the one-request-per-second MusicBrainz limit.
- Cache shared results.
- Normalize inconsistent API data.
- Avoid exposing raw Lucene query construction to the client.

### 10.1 Search endpoint

```http
GET /api/albums?decade=1970&genre=disco&offset=0&limit=40
```

#### Validation

- `decade`: required integer corresponding to an allowed decade.
- `genre`: required nonempty string.
- `offset`: integer, minimum 0, default 0.
- `limit`: integer from 1 to 40, default 40.

#### Response

```json
{
  "query": {
    "decade": 1970,
    "genre": "disco",
    "offset": 0,
    "limit": 40
  },
  "total": 826,
  "items": [
    {
      "id": "release-group-mbid",
      "title": "Album title",
      "artist": "Artist credit",
      "firstReleaseDate": "1977-04-22",
      "year": 1977,
      "primaryType": "Album",
      "secondaryTypes": [],
      "score": 100,
      "cover": {
        "grid": "https://coverartarchive.org/release-group/release-group-mbid/front-500",
        "detail": "https://coverartarchive.org/release-group/release-group-mbid/front-1200"
      },
      "musicBrainzUrl": "https://musicbrainz.org/release-group/release-group-mbid"
    }
  ],
  "nextOffset": 40,
  "hasMore": true,
  "isExhaustive": false
}
```

### `isExhaustive`

Return `false` because:

- MusicBrainz tags may be incomplete.
- Some matching release groups lack cover art.
- Failed or unavailable image endpoints may be removed from display.

### 10.2 Genre endpoint

```http
GET /api/genres?offset=0&limit=100
```

The backend calls:

```text
GET https://musicbrainz.org/ws/2/genre/all?fmt=json&limit=100&offset=0
```

Cache the complete genre list for at least seven days.

### 10.3 Album detail endpoint

```http
GET /api/albums/{releaseGroupMbid}
```

On demand, retrieve release-group metadata with genres:

```text
GET https://musicbrainz.org/ws/2/release-group/{MBID}?inc=genres&fmt=json
```

This endpoint should be called only when a user opens an album detail view. Cache results.

---

## 11. MusicBrainz Compliance and Traffic Control

### User-Agent

Every MusicBrainz request must include a meaningful User-Agent in this pattern:

```text
AlbumCoverGrid/1.0 (https://your-domain.example/contact)
```

Replace the placeholder domain with a real contact page or maintainer contact before deployment.

### Rate limiting

The application must never send more than **one MusicBrainz request per second per public application/IP**, unless a separate agreement explicitly allows otherwise.

Implement a shared request queue or token bucket.

For a horizontally scaled or serverless deployment, do not rely only on process memory. Use a shared store or queue, such as Redis, to coordinate throttling across instances.

### Retry policy

Retry MusicBrainz requests for `429`, `503`, and transient network failures.

Recommended policy:

- Maximum 3 attempts.
- Exponential backoff with jitter.
- Minimum spacing must still respect the one-request-per-second rule.
- Do not retry normal `400` or `404` responses.

### Caching

Recommended cache durations:

- Search response by normalized filters and offset: 24 hours.
- Release-group detail: 7 days.
- Genre list: 7 days.
- Negative cover-art result: 24 hours.

Cache keys must include all request-shaping parameters.

Example:

```text
albums:v1:decade=1970:genre=disco:offset=0:limit=40
```

---

## 12. Cover Availability Strategy

The MusicBrainz release-group search response does not guarantee that a canonical front cover exists.

### Required MVP strategy

1. Return normalized search results with predictable Cover Art Archive URLs.
2. Let the browser lazily request each `front-500` image.
3. If an image returns `404` or fails to decode, hide that card from the final grid.
4. Continue fetching additional MusicBrainz pages when too many results lack covers, until one of these conditions is met:
   - The UI has filled the requested visible batch.
   - MusicBrainz has no more results.
   - A safety limit of three upstream pages has been checked for a single user pagination action.
5. Do not create an endless request loop when art coverage is poor.

### Preferred enhanced strategy

Maintain a negative-result cache for release groups that do not have a front cover. This prevents repeated failed image requests across sessions.

### Empty result behavior

Use this message when metadata matches exist but covers do not:

> Matching albums were found, but no usable front-cover images were available. Try a broader genre or another decade.

Use this message when MusicBrainz returns no matches:

> No matching albums were found. Try another genre or decade.

---

## 13. Pagination and Sorting

### Pagination

Use infinite scroll with an explicit fallback button labeled `Load more`.

Requirements:

- Use an Intersection Observer sentinel.
- Never issue duplicate pagination requests.
- Cancel or ignore stale requests when filters change.
- Reset offset and results when either filter changes.
- Preserve the scroll position when closing the album detail view.
- Stop requesting pages when `hasMore` is false.

### Sorting

MVP default: use MusicBrainz search relevance order.

Optional sort choices:

- Relevance.
- Oldest first.
- Newest first.
- Artist A–Z.
- Album A–Z.

Note: client-side sorting only sorts the results already loaded. A globally accurate sort requires fetching the full result set or maintaining a separate index. Do not falsely label a page-local sort as global.

---

## 14. State Management

Maintain these states:

```ts
type GalleryState = {
  decade: number | null;
  genre: string | null;
  items: AlbumCard[];
  offset: number;
  hasMore: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  error: string | null;
  selectedAlbumId: string | null;
};
```

### Filter change behavior

When decade or genre changes:

1. Update URL parameters.
2. Cancel or invalidate the current request.
3. Clear current items.
4. Reset offset to zero.
5. Show the initial loading skeleton.
6. Request the first page.
7. Move keyboard focus to the gallery status message when appropriate for accessibility.

---

## 15. Error Handling

### MusicBrainz unavailable

Show:

> Album metadata is temporarily unavailable. Please try again.

Provide a retry button.

### Cover Art Archive unavailable

Retain album metadata cards only if the design has a polished image-unavailable state. Otherwise hide failed cards and show a nonblocking status message if failure rates are high.

### Invalid filters

Return HTTP `400` with a structured body:

```json
{
  "error": {
    "code": "INVALID_FILTER",
    "message": "The requested decade or genre is invalid."
  }
}
```

### Request timeout

- MusicBrainz server request timeout: 10 seconds.
- Cover image loading is handled by the browser and should not block metadata rendering.

### Stale request race condition

If the user changes filters before a request finishes, discard the old response. Results from an earlier filter combination must never appear in the new grid.

---

## 16. Accessibility Requirements

- All filters must have visible labels.
- Full keyboard navigation is required.
- Cards must be keyboard-focusable when they open details.
- Use semantic buttons for actions, not clickable `div` elements.
- Album image alt text format:

```text
Cover of {album title} by {artist}
```

- The detail modal must trap focus and restore focus to the originating card when closed.
- Escape closes the modal.
- Loading and result-count changes use an appropriate polite live region.
- Text and controls must meet WCAG AA contrast.
- Do not rely on hover to reveal essential metadata.
- Respect reduced-motion preferences.

---

## 17. Performance Requirements

### Targets

- Initial page shell should render without waiting for MusicBrainz.
- Avoid loading original-resolution artwork in the grid.
- Use lazy loading for off-screen images.
- Keep cumulative layout shift low by reserving square image space.
- Avoid more than 40 image requests in the initial batch.
- Deduplicate identical release-group MBIDs before rendering.
- Cache server responses.
- Abort stale browser requests.

### Image optimization caution

Framework image proxies can accidentally create a large number of duplicate or transformed requests. Ensure the chosen image component:

- Allows the Cover Art Archive and Internet Archive redirect hosts.
- Preserves redirect handling.
- Does not request arbitrary unsupported widths.
- Uses the existing 500px and 1200px CAA thumbnails rather than repeatedly reprocessing originals.

A normal responsive `<img>` is acceptable for MVP.

---

## 18. Security Requirements

- Validate all query parameters server-side.
- Escape Lucene special characters.
- Do not accept arbitrary upstream URLs from the client.
- Construct MusicBrainz and Cover Art Archive URLs from validated values and MBIDs.
- Validate MBIDs as UUIDs before using them in upstream paths.
- Add sensible API request limits per client to prevent abuse of the backend proxy.
- Never expose private credentials; these public APIs do not require an API key for read-only MVP use.
- Do not implement an open proxy.

---

## 19. Rights, Licensing, and Attribution

The application must include a footer or About page containing:

- `Metadata provided by MusicBrainz.`
- `Cover images provided by the Cover Art Archive and hosted by the Internet Archive.`
- A notice that cover images remain copyrighted by their respective owners.

Do not imply that the application owns or relicenses album artwork.

Before commercial deployment, confirm MusicBrainz commercial-use terms or obtain the appropriate MetaBrainz plan/permission. Non-commercial API availability must not be interpreted as unrestricted commercial licensing of cover images.

---

## 20. Analytics

If privacy-respecting analytics are added, track:

- Gallery viewed.
- Decade selected.
- Genre selected.
- Filter combination returning zero metadata matches.
- Filter combination returning poor art coverage.
- Album detail opened.
- MusicBrainz outbound link clicked.
- Initial and pagination request failures.

Do not send album-cover image URLs or MBIDs to third-party analytics unless necessary and disclosed.

---

## 21. Suggested Technical Architecture

The specification is framework-neutral. A practical implementation may use:

- React-based frontend.
- TypeScript.
- Server-rendered application framework or a separate API backend.
- CSS Grid.
- Redis or another shared cache for production throttling and caching.
- Standard Fetch API with AbortController.

### Components

```text
App
├── Header
├── FilterBar
│   ├── DecadeSelect
│   └── GenreCombobox
├── GalleryStatus
├── AlbumGrid
│   └── AlbumCard
├── LoadMoreTrigger
├── AlbumDetailModal
└── FooterAttribution
```

### Server modules

```text
server/
├── musicbrainz-client
│   ├── user-agent
│   ├── rate-limiter
│   ├── retry
│   └── response-normalizer
├── cover-art-url-builder
├── lucene-query-builder
├── cache
└── validation
```

---

## 22. Normalized Data Types

```ts
type AlbumCard = {
  id: string;
  title: string;
  artist: string;
  firstReleaseDate: string | null;
  year: number | null;
  primaryType: string | null;
  secondaryTypes: string[];
  score: number | null;
  cover: {
    grid: string;
    detail: string;
  };
  musicBrainzUrl: string;
};

type AlbumDetails = AlbumCard & {
  genres: Array<{
    id?: string;
    name: string;
    count?: number;
  }>;
};
```

### Artist-credit normalization

MusicBrainz artist credits may contain multiple artists and join phrases. Preserve the credited display text.

Example:

```text
Artist A feat. Artist B
```

Do not simply join artist names with commas if join phrases are provided.

---

## 23. Acceptance Criteria

### Filtering

- [ ] User can select one decade.
- [ ] User can select one genre.
- [ ] The two filters can be combined.
- [ ] The active values are present in the URL.
- [ ] Reloading the URL restores the same filtered view.
- [ ] Decade `1970` generates an inclusive MusicBrainz date range from `1970-01-01` to `1979-12-31`.
- [ ] Genre `Disco` generates a safely escaped `tag:"disco"` clause.
- [ ] MVP queries default to official album release groups.

### Gallery

- [ ] Results are deduplicated by release-group MBID.
- [ ] The grid is responsive from phone to large desktop.
- [ ] The 500px CAA thumbnail is used in the grid.
- [ ] Images load lazily.
- [ ] Cards preserve a square image area while loading.
- [ ] Broken or missing cover images do not leave broken-image icons.
- [ ] Each card displays title, artist, and year when available.

### Detail view

- [ ] Clicking or activating a card opens details.
- [ ] The 1200px CAA thumbnail is used in details.
- [ ] Details include a MusicBrainz link.
- [ ] Modal keyboard and focus behavior meet the accessibility requirements.

### API behavior

- [ ] Browser clients call the application's API, not MusicBrainz directly.
- [ ] MusicBrainz requests contain a meaningful User-Agent.
- [ ] MusicBrainz traffic is throttled to no more than one request per second.
- [ ] Search, detail, genre, and negative-art results are cached.
- [ ] Retries do not violate the rate limit.
- [ ] Invalid inputs return structured `400` responses.
- [ ] Filter changes cannot mix stale and current results.

### Empty and error states

- [ ] No-metadata and no-cover situations have distinct messages.
- [ ] Temporary upstream failures have a retry action.
- [ ] Users can change filters even while an error state is shown.

### Attribution

- [ ] MusicBrainz attribution is visible.
- [ ] Cover Art Archive and Internet Archive attribution is visible.
- [ ] Artwork copyright notice is visible.

---

## 24. Test Plan

### Unit tests

- Decade-to-date-range conversion.
- Lucene character escaping.
- Genre normalization.
- Query builder output.
- Artist-credit display normalization.
- First-release-year parsing for `YYYY`, `YYYY-MM`, and `YYYY-MM-DD`.
- MBID validation.
- Pagination calculations.
- Cache-key normalization.
- Upstream error mapping.

### Integration tests

Mock MusicBrainz and Cover Art Archive responses for:

- Valid album results with artwork.
- Valid album results without artwork.
- Duplicate release-group MBIDs.
- Partial dates.
- Multiple artist credits with join phrases.
- Empty results.
- MusicBrainz `503` followed by success.
- Cover Art Archive `307` redirect.
- Cover Art Archive `404`.
- Invalid client filters.
- Cache hit.
- Cache miss.
- Stale request cancellation.

### End-to-end tests

- Select `1970s` and `Disco`, verify URL and grid update.
- Reload and verify filters persist.
- Scroll/load another page without duplicates.
- Open and close an album detail view with keyboard only.
- Change filters rapidly and verify results never mix.
- Simulate image failures and verify no broken icons appear.
- Simulate upstream outage and verify retry UI.
- Test 2-, 3-, 4-, 6-, and 8-column layouts at representative viewport widths.

---

## 25. Implementation Sequence for an LLM Coding Agent

Build in this order:

1. Create the application shell and responsive layout.
2. Implement shared types and validation.
3. Implement the Lucene query builder with tests.
4. Implement the MusicBrainz client with User-Agent, throttling, retries, and JSON parsing.
5. Implement server caching.
6. Implement `/api/albums` and normalization.
7. Implement the decade and genre controls with URL state.
8. Implement the cover grid using generated CAA release-group image URLs.
9. Implement image-failure handling and pagination.
10. Implement the album detail endpoint and modal.
11. Add empty, degraded, and error states.
12. Add accessibility behavior.
13. Add attribution and rights notices.
14. Add unit, integration, and end-to-end tests.
15. Perform responsive and performance review.

### Coding-agent guardrails

- Do not invent a Cover Art Archive search endpoint.
- Do not scrape MusicBrainz HTML pages.
- Do not query individual releases when a release-group result is sufficient.
- Do not make one MusicBrainz metadata request per grid card.
- Do not exceed one MusicBrainz request per second.
- Do not use original-resolution images in the grid.
- Do not omit the User-Agent.
- Do not expose an unrestricted backend proxy.
- Do not describe genre results as complete or authoritative.
- Do not replace the specified APIs with another music provider without explicit approval.

---

## 26. Future Enhancements

- Multiple genre selection with AND/OR behavior.
- Custom year range.
- Release type filters for album, EP, single, compilation, soundtrack, and live album.
- Country filter.
- Record-label filter.
- Color extraction and filter-by-dominant-color.
- Visual similarity search.
- Saved mood boards.
- Side-by-side cover comparison.
- Back-cover and booklet browsing.
- Randomize/shuffle mode.
- Full-screen slideshow.
- Local favorites export.
- Curated collections such as “1970s jazz typography” or “1980s new-wave photography.”
- Self-hosted MusicBrainz data/index for high-volume applications.

---

## 27. Official Technical References

- Cover Art Archive: https://coverartarchive.org/
- Cover Art Archive API: https://musicbrainz.org/doc/Cover_Art_Archive/API
- MusicBrainz API: https://musicbrainz.org/doc/MusicBrainz_API
- MusicBrainz release-group search fields: https://musicbrainz.org/doc/MusicBrainz_API/Search/ReleaseGroupSearch
- MusicBrainz indexed search syntax: https://musicbrainz.org/doc/Indexed_Search_Syntax
- MusicBrainz rate limiting: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- MusicBrainz release groups: https://musicbrainz.org/doc/Release_Group
- MusicBrainz genres: https://musicbrainz.org/doc/Genre
- MusicBrainz data licensing: https://musicbrainz.org/doc/About/Data_License

---

## 28. Definition of Done

The MVP is complete when a user can open the application, select a decade and genre, browse a responsive grid of nonduplicate album-cover images, load more results, inspect an album, and follow its MusicBrainz link—while the backend remains compliant with MusicBrainz identification and rate-limit requirements and the UI handles missing artwork and upstream failures cleanly.
