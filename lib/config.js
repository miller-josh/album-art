'use strict';

const APP_NAME = 'AlbumCoverGrid';
const APP_VERSION = '0.1.0';

// Replace before any public deployment. MusicBrainz requires a contactable UA.
const CONTACT = process.env.MB_CONTACT || 'https://example.invalid/album-cover-grid';

const USER_AGENT = `${APP_NAME}/${APP_VERSION} ( ${CONTACT} )`;

// Decades are generated, not listed. To support earlier decades, lower
// EARLIEST_DECADE. No other code changes are required.
const EARLIEST_DECADE = 1950;

function currentDecade(now = new Date()) {
  return Math.floor(now.getUTCFullYear() / 10) * 10;
}

function allowedDecades(now = new Date()) {
  const out = [];
  for (let d = EARLIEST_DECADE; d <= currentDecade(now); d += 10) out.push(d);
  return out;
}

// Seed list only. /api/genres serves the live MusicBrainz list when reachable
// and falls back to this.
const CURATED_GENRES = [
  'alternative rock', 'blues', 'country', 'disco', 'electronic', 'folk',
  'funk', 'hip hop', 'jazz', 'metal', 'new wave', 'pop', 'punk', 'r&b',
  'reggae', 'rock', 'soul',
];

module.exports = {
  APP_NAME,
  APP_VERSION,
  CONTACT,
  USER_AGENT,
  EARLIEST_DECADE,
  currentDecade,
  allowedDecades,
  CURATED_GENRES,

  MB_BASE: 'https://musicbrainz.org/ws/2',
  MB_WEB: 'https://musicbrainz.org',
  CAA_BASE: 'https://coverartarchive.org',

  // Traffic control
  MB_MIN_INTERVAL_MS: 1100,   // one request per second, with headroom
  MB_TIMEOUT_MS: 10_000,
  MB_MAX_ATTEMPTS: 3,

  // Cache TTLs (ms)
  TTL_SEARCH: 24 * 60 * 60 * 1000,
  TTL_DETAIL: 7 * 24 * 60 * 60 * 1000,
  TTL_GENRES: 7 * 24 * 60 * 60 * 1000,
  TTL_NO_COVER: 24 * 60 * 60 * 1000,

  // Request shaping
  MAX_LIMIT: 40,
  DEFAULT_LIMIT: 40,
  MAX_OFFSET: 10_000,
  MAX_GENRE_LENGTH: 80,

  // Backend abuse guard (per IP)
  IP_WINDOW_MS: 60_000,
  IP_MAX_REQUESTS: 120,

  PORT: Number(process.env.PORT || 3000),
};
