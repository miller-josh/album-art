'use strict';

const { quotePhrase, escapeTerm, normalizeGenre } = require('./lucene');

/**
 * A decade is represented internally by its starting year (1970) and
 * expanded to an inclusive date range at query time.
 */
function decadeToRange(decade) {
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
function buildReleaseGroupQuery({ decade, genre, text }) {
  const { start, end } = decadeToRange(decade);
  const clauses = [
    `firstreleasedate:[${start} TO ${end}]`,
    `tag:${quotePhrase(normalizeGenre(genre))}`,
    'primarytype:album',
    'status:official',
  ];

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
function searchCacheKey({ decade, genre, offset, limit, text }) {
  const base = `albums:v1:decade=${decade}:genre=${normalizeGenre(genre)}` +
    `:offset=${offset}:limit=${limit}`;
  const t = typeof text === 'string' ? text.trim().toLowerCase() : '';
  return t ? `${base}:text=${t}` : base;
}

module.exports = { decadeToRange, buildReleaseGroupQuery, searchCacheKey };
