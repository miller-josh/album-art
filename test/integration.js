'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Shorten the throttle interval before the limiter is constructed. The
// spacing behaviour itself is asserted below against this value.
const config = require('../lib/config');
config.MB_MIN_INTERVAL_MS = 40;

const { server } = require('../server');
const { searchCache, detailCache, genreCache, noCoverCache } = require('../lib/cache');

const MBID = '0f6d4b6a-1d3f-4d8e-9c2a-3b1e5f7a9c11';
const MBID2 = '11111111-2222-3333-4444-555555555555';

let base;
const realFetch = globalThis.fetch;

/** Queue of canned upstream responses, plus a log of the URLs requested. */
let upstream = [];
const calls = [];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function searchPayload(ids, count = ids.length) {
  return {
    count,
    'release-groups': ids.map((id, i) => ({
      id,
      title: `Album ${i}`,
      'first-release-date': '1977-05',
      'primary-type': 'Album',
      score: 100 - i,
      'artist-credit': [{ name: 'Artist A', joinphrase: ' feat. ' }, { name: 'Artist B' }],
    })),
  };
}

before(async () => {
  globalThis.fetch = async (url) => {
    calls.push({ url: String(url), at: Date.now() });
    const next = upstream.shift();
    if (!next) return jsonResponse({ count: 0, 'release-groups': [] });
    if (next instanceof Error) throw next;
    return next;
  };

  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

function reset() {
  upstream = [];
  calls.length = 0;
  for (const c of [searchCache, detailCache, genreCache, noCoverCache]) c.map.clear();
}

/** The browser talks to our API using the real fetch, not the stub. */
const get = (path, init) => realFetch(base + path, init);

/* ------------------------------------------------------------------ tests */

test('search returns normalized items with cover URLs', async () => {
  reset();
  upstream.push(jsonResponse(searchPayload([MBID, MBID2], 826)));

  const res = await get('/api/albums?decade=1970&genre=disco');
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.total, 826);
  assert.equal(body.items.length, 2);
  assert.equal(body.hasMore, true);
  assert.equal(body.nextOffset, 40);
  assert.equal(body.isExhaustive, false);
  assert.equal(body.items[0].artist, 'Artist A feat. Artist B');
  assert.equal(body.items[0].year, 1977);
  assert.match(body.items[0].cover.grid, /front-500$/);
  assert.match(body.items[0].cover.detail, /front-1200$/);

  // The upstream request carried the escaped query and a real User-Agent.
  const upstreamUrl = new URL(calls[0].url);
  assert.equal(upstreamUrl.searchParams.get('fmt'), 'json');
  assert.ok(upstreamUrl.searchParams.get('query').includes('tag:"disco"'));
  assert.ok(upstreamUrl.searchParams.get('query').includes('1970-01-01 TO 1979-12-31'));
});

test('identical searches are served from cache', async () => {
  reset();
  upstream.push(jsonResponse(searchPayload([MBID])));

  await get('/api/albums?decade=1970&genre=disco');
  await get('/api/albums?decade=1970&genre=Disco'); // normalizes to the same key

  assert.equal(calls.length, 1, 'second identical search should not hit upstream');
});

test('invalid filters return a structured 400', async () => {
  reset();
  const res = await get('/api/albums?decade=1975&genre=disco');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_FILTER');
  assert.ok(body.error.message);
  assert.equal(calls.length, 0, 'invalid input must not reach upstream');
});

test('missing genre returns 400 without calling upstream', async () => {
  reset();
  const res = await get('/api/albums?decade=1970');
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('retries a 503 and then succeeds', async () => {
  reset();
  upstream.push(jsonResponse({}, 503));
  upstream.push(jsonResponse(searchPayload([MBID])));

  const res = await get('/api/albums?decade=1980&genre=punk');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test('a persistent upstream failure maps to 502 with a retryable message', async () => {
  reset();
  upstream.push(jsonResponse({}, 503));
  upstream.push(jsonResponse({}, 503));
  upstream.push(jsonResponse({}, 503));

  const res = await get('/api/albums?decade=1990&genre=jazz');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(calls.length, 3, 'attempts must stop at the configured maximum');
});

test('a 400 from upstream is not retried', async () => {
  reset();
  upstream.push(jsonResponse({}, 400));

  const res = await get('/api/albums?decade=2000&genre=metal');
  assert.equal(res.status, 502);
  assert.equal(calls.length, 1);
});

test('upstream requests are spaced by the rate limiter', async () => {
  reset();
  for (let i = 0; i < 3; i += 1) upstream.push(jsonResponse(searchPayload([MBID])));

  await Promise.all([
    get('/api/albums?decade=1960&genre=folk'),
    get('/api/albums?decade=1960&genre=blues'),
    get('/api/albums?decade=1960&genre=soul'),
  ]);

  assert.equal(calls.length, 3);
  for (let i = 1; i < calls.length; i += 1) {
    const gap = calls[i].at - calls[i - 1].at;
    assert.ok(gap >= config.MB_MIN_INTERVAL_MS - 5, `gap ${gap}ms was too small`);
  }
});

test('reported missing covers are filtered from later searches', async () => {
  reset();
  upstream.push(jsonResponse(searchPayload([MBID, MBID2])));

  const first = await (await get('/api/albums?decade=1970&genre=funk')).json();
  assert.equal(first.items.length, 2);

  const report = await get('/api/cover-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missing: [MBID2, 'not-a-uuid'] }),
  });
  assert.equal((await report.json()).recorded, 1, 'only valid MBIDs are recorded');

  const second = await (await get('/api/albums?decade=1970&genre=funk')).json();
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].id, MBID);
  assert.equal(second.knownMissingArt, 1);
});

test('album detail returns genres and rejects a bad MBID', async () => {
  reset();
  upstream.push(jsonResponse({
    id: MBID,
    title: 'Album 0',
    'first-release-date': '1977-11-15',
    'primary-type': 'Album',
    'artist-credit': [{ name: 'Chic' }],
    genres: [{ name: 'disco', count: 9 }, { name: 'funk', count: 3 }],
  }));

  const ok = await get(`/api/albums/${MBID}`);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.title, 'Album 0');
  assert.deepEqual(body.genres.map((g) => g.name), ['disco', 'funk']);

  const bad = await get('/api/albums/not-a-uuid');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_MBID');
});

test('album detail is cached', async () => {
  reset();
  upstream.push(jsonResponse({
    id: MBID, title: 'X', 'artist-credit': [{ name: 'Y' }], genres: [],
  }));
  await get(`/api/albums/${MBID}`);
  await get(`/api/albums/${MBID}`);
  assert.equal(calls.length, 1);
});

test('genre list falls back to the curated list when upstream fails', async () => {
  reset();
  upstream.push(jsonResponse({}, 503));
  upstream.push(jsonResponse({}, 503));
  upstream.push(jsonResponse({}, 503));

  const res = await get('/api/genres');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'curated');
  assert.ok(body.curated.includes('disco'));
  // Decades ship with the genre payload so the client has one source of truth.
  assert.ok(Array.isArray(body.decades) && body.decades.includes(1970));
});

test('serves the app shell and blocks path traversal', async () => {
  reset();
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Album Cover Grid/);

  const traversal = await get('/../server.js');
  assert.ok([400, 403, 404].includes(traversal.status), `got ${traversal.status}`);
});

test('unknown API endpoints and methods are rejected', async () => {
  reset();
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/albums', { method: 'DELETE' })).status, 404);
});
