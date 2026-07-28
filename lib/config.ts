export const APP_NAME = 'AlbumCoverGrid';
export const APP_VERSION = '0.1.0';

// Replace before any public deployment. MusicBrainz requires a contactable UA.
export const CONTACT =
  process.env.MB_CONTACT || 'https://example.invalid/album-cover-grid';

export const USER_AGENT = `${APP_NAME}/${APP_VERSION} ( ${CONTACT} )`;

// Decades are generated, not listed. To support earlier decades, lower
// EARLIEST_DECADE. No other code changes are required.
export const EARLIEST_DECADE = 1950;

export function currentDecade(now: Date = new Date()): number {
  return Math.floor(now.getUTCFullYear() / 10) * 10;
}

export function allowedDecades(now: Date = new Date()): number[] {
  const out: number[] = [];
  for (let d = EARLIEST_DECADE; d <= currentDecade(now); d += 10) out.push(d);
  return out;
}

// Seed list only. /api/genres serves the live MusicBrainz list when reachable
// and falls back to this.
export const CURATED_GENRES = [
  'alternative rock', 'blues', 'country', 'disco', 'electronic', 'folk',
  'funk', 'hip hop', 'jazz', 'metal', 'new wave', 'pop', 'punk', 'r&b',
  'reggae', 'rock', 'soul',
];

export const MB_BASE = 'https://musicbrainz.org/ws/2';
export const MB_WEB = 'https://musicbrainz.org';
export const CAA_BASE = 'https://coverartarchive.org';

// Traffic control. The interval is env-overridable so tests can shorten the
// throttle without mutating module state; production never sets it.
export const MB_MIN_INTERVAL_MS =
  Number(process.env.MB_MIN_INTERVAL_MS) || 1100; // one request per second, with headroom
export const MB_TIMEOUT_MS = 10_000;
export const MB_MAX_ATTEMPTS = 3;

// Cache TTLs (ms)
export const TTL_SEARCH = 24 * 60 * 60 * 1000;
export const TTL_DETAIL = 7 * 24 * 60 * 60 * 1000;
export const TTL_GENRES = 7 * 24 * 60 * 60 * 1000;
export const TTL_NO_COVER = 24 * 60 * 60 * 1000;

// Request shaping
export const MAX_LIMIT = 40;
export const DEFAULT_LIMIT = 40;
export const MAX_OFFSET = 10_000;
export const MAX_GENRE_LENGTH = 80;

// Backend abuse guard (per IP)
export const IP_WINDOW_MS = 60_000;
export const IP_MAX_REQUESTS = 120;

export const PORT = Number(process.env.PORT || 3000);
