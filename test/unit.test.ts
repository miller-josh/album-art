import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeTerm, quotePhrase, normalizeGenre } from '../lib/lucene';
import { decadeToRange, buildReleaseGroupQuery, searchCacheKey } from '../lib/query';
import { artistCreditToString, parseYear, toAlbumCard, normalizeSearch } from '../lib/normalize';
import { parseAlbumQuery, isMbid, ValidationError } from '../lib/validate';
import { TtlCache } from '../lib/cache';
import * as config from '../lib/config';

const MBID = '0f6d4b6a-1d3f-4d8e-9c2a-3b1e5f7a9c11';

/* ---------------------------------------------------- decade conversion */

test('decade converts to an inclusive date range', () => {
  assert.deepEqual(decadeToRange(1970), { start: '1970-01-01', end: '1979-12-31' });
  assert.deepEqual(decadeToRange(2020), { start: '2020-01-01', end: '2029-12-31' });
});

test('decade rejects non-decade values', () => {
  assert.throws(() => decadeToRange(1975), TypeError);
  assert.throws(() => decadeToRange('abc' as unknown as number), TypeError);
});

test('allowed decades are generated, not hardcoded', () => {
  const decades = config.allowedDecades(new Date('2026-07-28T00:00:00Z'));
  assert.equal(decades[0], 1950);
  assert.equal(decades.at(-1), 2020);
  assert.ok(decades.includes(1970));
  // Every entry is a decade start, with no gaps.
  decades.forEach((d, i) => assert.equal(d, 1950 + i * 10));
});

/* ------------------------------------------------------ Lucene escaping */

test('escapeTerm escapes reserved characters', () => {
  assert.equal(escapeTerm('rock'), 'rock');
  assert.equal(escapeTerm('AC/DC'), 'AC\\/DC');
  assert.equal(escapeTerm('a:b'), 'a\\:b');
  assert.equal(escapeTerm('wild*'), 'wild\\*');
  assert.equal(escapeTerm('back\\slash'), 'back\\\\slash');
  assert.equal(escapeTerm('a && b'), 'a \\&\\& b');
});

test('quotePhrase cannot be broken out of', () => {
  assert.equal(quotePhrase('disco'), '"disco"');
  assert.equal(quotePhrase('hip hop'), '"hip hop"');
  assert.equal(quotePhrase('r&b'), '"r&b"');
  // An injection attempt stays inside the quotes.
  const hostile = quotePhrase('x" OR primarytype:single OR tag:"y');
  assert.equal(hostile, '"x\\" OR primarytype:single OR tag:\\"y"');
  assert.equal((hostile.match(/(?<!\\)"/g) || []).length, 2);
});

test('genre normalization is stable for cache keys', () => {
  assert.equal(normalizeGenre('  Hip   Hop '), 'hip hop');
  assert.equal(normalizeGenre('DISCO'), 'disco');
  assert.equal(normalizeGenre('New\tWave'), 'new wave');
});

/* -------------------------------------------------------- query builder */

test('builds the documented default query', () => {
  const q = buildReleaseGroupQuery({ decade: 1970, genre: 'Disco' });
  assert.equal(
    q,
    'firstreleasedate:[1970-01-01 TO 1979-12-31] AND tag:"disco" ' +
      'AND primarytype:album AND status:official',
  );
});

test('multiword genres stay quoted', () => {
  const q = buildReleaseGroupQuery({ decade: 1980, genre: 'New Wave' });
  assert.ok(q.includes('tag:"new wave"'));
  assert.ok(q.includes('firstreleasedate:[1980-01-01 TO 1989-12-31]'));
});

test('optional text never replaces the decade and genre restrictions', () => {
  const q = buildReleaseGroupQuery({ decade: 1970, genre: 'disco', text: 'Chic' });
  assert.ok(q.includes('tag:"disco"'));
  assert.ok(q.includes('firstreleasedate:['));
  assert.ok(q.includes('primarytype:album'));
  assert.ok(q.includes('Chic'));
});

test('cache keys include every request-shaping parameter', () => {
  const key = searchCacheKey({ decade: 1970, genre: 'Disco', offset: 0, limit: 40 });
  assert.equal(key, 'albums:v1:decade=1970:genre=disco:offset=0:limit=40');
  const a = searchCacheKey({ decade: 1970, genre: 'disco', offset: 40, limit: 40 });
  assert.notEqual(key, a);
});

/* ------------------------------------------------------ date and credits */

test('parses full, partial, and year-only dates', () => {
  assert.equal(parseYear('1977-04-22'), 1977);
  assert.equal(parseYear('1977-05'), 1977);
  assert.equal(parseYear('1977'), 1977);
  assert.equal(parseYear(''), null);
  assert.equal(parseYear(null), null);
  assert.equal(parseYear('77'), null);
});

test('artist credit preserves join phrases', () => {
  const credit = [
    { name: 'Diana Ross', joinphrase: ' & ' },
    { name: 'Marvin Gaye', joinphrase: '' },
  ];
  assert.equal(artistCreditToString(credit), 'Diana Ross & Marvin Gaye');

  const feat = [
    { name: 'Artist A', joinphrase: ' feat. ' },
    { name: 'Artist B' },
  ];
  assert.equal(artistCreditToString(feat), 'Artist A feat. Artist B');

  assert.equal(artistCreditToString([]), 'Unknown artist');
  assert.equal(artistCreditToString(undefined), 'Unknown artist');
});

/* --------------------------------------------------------- normalization */

test('normalizes a release group into an AlbumCard', () => {
  const card = toAlbumCard({
    id: MBID,
    title: 'Saturday Night Fever',
    'first-release-date': '1977-11-15',
    'primary-type': 'Album',
    'secondary-types': ['Soundtrack'],
    score: 100,
    'artist-credit': [{ name: 'Various Artists' }],
  });
  assert.ok(card);
  assert.equal(card.year, 1977);
  assert.equal(card.artist, 'Various Artists');
  assert.deepEqual(card.secondaryTypes, ['Soundtrack']);
  assert.equal(card.cover.grid, `https://coverartarchive.org/release-group/${MBID}/front-500`);
  assert.equal(card.cover.detail, `https://coverartarchive.org/release-group/${MBID}/front-1200`);
  assert.equal(card.musicBrainzUrl, `https://musicbrainz.org/release-group/${MBID}`);
});

test('deduplicates repeated release-group MBIDs', () => {
  const payload = {
    count: 2,
    'release-groups': [
      { id: MBID, title: 'A', 'artist-credit': [{ name: 'X' }] },
      { id: MBID, title: 'A (reissue)', 'artist-credit': [{ name: 'X' }] },
    ],
  };
  const out = normalizeSearch(payload);
  assert.equal(out.items.length, 1);
});

test('drops release groups already known to have no cover', () => {
  const other = '11111111-2222-3333-4444-555555555555';
  const payload = {
    count: 2,
    'release-groups': [
      { id: MBID, title: 'A', 'artist-credit': [{ name: 'X' }] },
      { id: other, title: 'B', 'artist-credit': [{ name: 'Y' }] },
    ],
  };
  const out = normalizeSearch(payload, { excludeIds: new Set([other]) });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, MBID);
  assert.equal(out.filteredNoCover, 1);
});

test('handles an empty result payload', () => {
  const out = normalizeSearch({ count: 0, 'release-groups': [] });
  assert.deepEqual(out.items, []);
  assert.equal(out.total, 0);
});

/* ----------------------------------------------------------- validation */

test('accepts a valid album query', () => {
  const p = parseAlbumQuery(new URLSearchParams('decade=1970&genre=Disco'));
  assert.deepEqual(p, { decade: 1970, genre: 'disco', offset: 0, limit: 40, text: '' });
});

test('rejects invalid filters', () => {
  const bad = [
    'genre=disco', // no decade
    'decade=1970', // no genre
    'decade=1975&genre=disco', // not a decade start
    'decade=1870&genre=disco', // outside the allowed range
    'decade=abc&genre=disco',
    `decade=1970&genre=${'x'.repeat(81)}`,
    'decade=1970&genre=disco&limit=41',
    'decade=1970&genre=disco&limit=0',
    'decade=1970&genre=disco&offset=-1',
    'decade=1970&genre=disco&offset=1.5',
  ];
  for (const qs of bad) {
    assert.throws(
      () => parseAlbumQuery(new URLSearchParams(qs)),
      ValidationError,
      `expected rejection for: ${qs}`,
    );
  }
});

test('validates MBIDs before they reach an upstream path', () => {
  assert.ok(isMbid(MBID));
  assert.ok(!isMbid('not-a-uuid'));
  assert.ok(!isMbid('../../etc/passwd'));
  assert.ok(!isMbid(`${MBID}/../../admin`));
  assert.ok(!isMbid(''));
  assert.ok(!isMbid(null));
});

/* ---------------------------------------------------------------- cache */

test('cache expires entries and caps its size', () => {
  const c = new TtlCache<number>({ maxEntries: 2 });
  c.set('a', 1, 50);
  assert.equal(c.get('a'), 1);
  c.set('b', 2, 50);
  c.set('c', 3, 50);
  assert.equal(c.size, 2);
  assert.equal(c.get('a'), undefined); // evicted

  const d = new TtlCache<string>();
  d.set('x', 'v', -1);
  assert.equal(d.get('x'), undefined); // expired
});
