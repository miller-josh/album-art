import { quotePhrase, escapeTerm, normalizeGenre } from './lucene.js';

export interface DateRange {
  start: string;
  end: string;
}

export interface AlbumQuery {
  decade: number;
  genre: string;
  offset: number;
  limit: number;
  text?: string;
}

/**
 * A decade is represented internally by its starting year (1970) and
 * expanded to an inclusive date range at query time.
 */
export function decadeToRange(decade: number): DateRange {
  const start = Number(decade);
  if (!Number.isInteger(start) || start % 10 !== 0) {
    throw new TypeError(`decade must be a multiple of 10, received ${decade}`);
  }
  return { start: `${start}-01-01`, end: `${start + 9}-12-31` };
}

/**
 * Build the Lucene query for a release-group search.
 *
 * Produces, for decade 1970 and genre "disco":
 *   firstreleasedate:[1970-01-01 TO 1979-12-31] AND tag:"disco"
 *   AND primarytype:album AND status:official
 *
 * `text` is optional and can never replace the decade and genre restrictions.
 */
export function buildReleaseGroupQuery({
  decade,
  genre,
  text,
}: Pick<AlbumQuery, 'decade' | 'genre' | 'text'>): string {
  const { start, end } = decadeToRange(decade);
  const clauses = [`firstreleasedate:[${start} TO ${end}]`];

  // Genre is optional. With no genre the search browses the whole decade, so
  // the tag clause is omitted rather than matching an empty tag.
  const g = normalizeGenre(genre || '');
  if (g) clauses.push(`tag:${quotePhrase(g)}`);

  clauses.push('primarytype:album', 'status:official');

  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed) {
    const t = escapeTerm(trimmed);
    clauses.push(`(releasegroup:(${t}) OR artist:(${t}))`);
  }

  return clauses.join(' AND ');
}

/**
 * Cache key covering every parameter that shapes the upstream request.
 */
export function searchCacheKey({
  decade,
  genre,
  offset,
  limit,
  text,
}: AlbumQuery): string {
  const base =
    `albums:v1:decade=${decade}:genre=${normalizeGenre(genre)}` +
    `:offset=${offset}:limit=${limit}`;
  const t = typeof text === 'string' ? text.trim().toLowerCase() : '';
  return t ? `${base}:text=${t}` : base;
}
