'use strict';

const config = require('./config');

/**
 * Render a MusicBrainz artist-credit array as its credited display text.
 *
 * Join phrases carry meaning ("feat.", " & ", " with ") and are preserved
 * rather than replaced with commas.
 */
function artistCreditToString(credit) {
  if (!Array.isArray(credit) || credit.length === 0) return 'Unknown artist';
  const text = credit
    .map((part) => {
      const name = part?.name || part?.artist?.name || '';
      const join = part?.joinphrase || '';
      return name + join;
    })
    .join('')
    .trim();
  return text || 'Unknown artist';
}

/**
 * Parse a MusicBrainz partial date. Accepts YYYY, YYYY-MM, and YYYY-MM-DD.
 */
function parseYear(date) {
  if (typeof date !== 'string') return null;
  const m = /^(\d{4})(?:-\d{2})?(?:-\d{2})?$/.exec(date.trim());
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isInteger(year) ? year : null;
}

function coverUrls(mbid) {
  return {
    grid: `${config.CAA_BASE}/release-group/${mbid}/front-500`,
    detail: `${config.CAA_BASE}/release-group/${mbid}/front-1200`,
  };
}

function toAlbumCard(rg) {
  const id = rg?.id;
  if (!id) return null;
  const firstReleaseDate = rg['first-release-date'] || null;
  return {
    id,
    title: rg.title || 'Untitled',
    artist: artistCreditToString(rg['artist-credit']),
    firstReleaseDate: firstReleaseDate || null,
    year: parseYear(firstReleaseDate),
    primaryType: rg['primary-type'] || null,
    secondaryTypes: Array.isArray(rg['secondary-types']) ? rg['secondary-types'] : [],
    score: typeof rg.score === 'number' ? rg.score : null,
    cover: coverUrls(id),
    musicBrainzUrl: `${config.MB_WEB}/release-group/${id}`,
  };
}

/**
 * Normalize a search payload: map, drop unusable entries, dedupe by MBID.
 */
function normalizeSearch(payload, { excludeIds = new Set() } = {}) {
  const groups = Array.isArray(payload?.['release-groups'])
    ? payload['release-groups']
    : [];
  const seen = new Set();
  const items = [];
  let filteredNoCover = 0;

  for (const rg of groups) {
    const card = toAlbumCard(rg);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    if (excludeIds.has(card.id)) { filteredNoCover += 1; continue; }
    items.push(card);
  }

  return {
    items,
    total: typeof payload?.count === 'number' ? payload.count : items.length,
    filteredNoCover,
  };
}

function toAlbumDetails(rg) {
  const card = toAlbumCard(rg);
  if (!card) return null;
  const genres = Array.isArray(rg.genres)
    ? rg.genres
      .map((g) => ({ id: g.id, name: g.name, count: g.count }))
      .filter((g) => g.name)
      .sort((a, b) => (b.count || 0) - (a.count || 0))
    : [];
  return { ...card, genres };
}

module.exports = {
  artistCreditToString,
  parseYear,
  coverUrls,
  toAlbumCard,
  normalizeSearch,
  toAlbumDetails,
};
