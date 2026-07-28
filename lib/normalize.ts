import * as config from './config';
import type { AlbumCard, AlbumDetails, AlbumGenre } from './types';

// Loose shapes for the raw MusicBrainz JSON we read. Only the fields we touch
// are described; everything else is ignored.
interface RawArtistCreditPart {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
}

interface RawReleaseGroup {
  id?: string;
  title?: string;
  'first-release-date'?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'artist-credit'?: RawArtistCreditPart[];
  score?: number;
  genres?: Array<{ id?: string; name?: string; count?: number }>;
}

interface RawSearchPayload {
  'release-groups'?: RawReleaseGroup[];
  count?: number;
}

/**
 * Render a MusicBrainz artist-credit array as its credited display text.
 *
 * Join phrases carry meaning ("feat.", " & ", " with ") and are preserved
 * rather than replaced with commas.
 */
export function artistCreditToString(credit: unknown): string {
  if (!Array.isArray(credit) || credit.length === 0) return 'Unknown artist';
  const text = credit
    .map((part: RawArtistCreditPart) => {
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
export function parseYear(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const m = /^(\d{4})(?:-\d{2})?(?:-\d{2})?$/.exec(date.trim());
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isInteger(year) ? year : null;
}

export function coverUrls(mbid: string): AlbumCard['cover'] {
  return {
    grid: `${config.CAA_BASE}/release-group/${mbid}/front-500`,
    detail: `${config.CAA_BASE}/release-group/${mbid}/front-1200`,
  };
}

export function toAlbumCard(rg: RawReleaseGroup): AlbumCard | null {
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

export interface NormalizedSearch {
  items: AlbumCard[];
  total: number;
  filteredNoCover: number;
}

/**
 * Normalize a search payload: map, drop unusable entries, dedupe by MBID.
 */
export function normalizeSearch(
  payload: RawSearchPayload | null | undefined,
  { excludeIds = new Set<string>() }: { excludeIds?: Set<string> } = {},
): NormalizedSearch {
  const groups = Array.isArray(payload?.['release-groups'])
    ? payload!['release-groups']!
    : [];
  const seen = new Set<string>();
  const items: AlbumCard[] = [];
  let filteredNoCover = 0;

  for (const rg of groups) {
    const card = toAlbumCard(rg);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    if (excludeIds.has(card.id)) {
      filteredNoCover += 1;
      continue;
    }
    items.push(card);
  }

  return {
    items,
    total: typeof payload?.count === 'number' ? payload.count : items.length,
    filteredNoCover,
  };
}

export function toAlbumDetails(rg: RawReleaseGroup): AlbumDetails | null {
  const card = toAlbumCard(rg);
  if (!card) return null;
  const genres: AlbumGenre[] = Array.isArray(rg.genres)
    ? rg.genres
        .map((g) => ({ id: g.id, name: g.name ?? '', count: g.count }))
        .filter((g) => g.name)
        .sort((a, b) => (b.count || 0) - (a.count || 0))
    : [];
  return { ...card, genres };
}
