'use strict';

const config = require('./config');
const { normalizeGenre } = require('./lucene');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ValidationError extends Error {
  constructor(message, code = 'INVALID_FILTER') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function isMbid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function parseIntParam(raw, { name, min, max, fallback }) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (!/^-?\d+$/.test(String(raw).trim())) {
    throw new ValidationError(`${name} must be an integer.`);
  }
  const n = Number(raw);
  if (n < min || n > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}.`);
  }
  return n;
}

/**
 * Validate and normalize the /api/albums query string.
 */
function parseAlbumQuery(searchParams) {
  const rawDecade = searchParams.get('decade');
  if (rawDecade === null || rawDecade === '') {
    throw new ValidationError('A decade is required.');
  }
  if (!/^\d+$/.test(rawDecade)) {
    throw new ValidationError('The requested decade or genre is invalid.');
  }
  const decade = Number(rawDecade);
  if (!config.allowedDecades().includes(decade)) {
    throw new ValidationError('The requested decade or genre is invalid.');
  }

  const rawGenre = searchParams.get('genre');
  if (!rawGenre || !rawGenre.trim()) {
    throw new ValidationError('A genre is required.');
  }
  if (rawGenre.length > config.MAX_GENRE_LENGTH) {
    throw new ValidationError(
      `Genre must be ${config.MAX_GENRE_LENGTH} characters or fewer.`,
    );
  }
  const genre = normalizeGenre(rawGenre);
  if (!genre) throw new ValidationError('A genre is required.');

  const offset = parseIntParam(searchParams.get('offset'), {
    name: 'offset', min: 0, max: config.MAX_OFFSET, fallback: 0,
  });
  const limit = parseIntParam(searchParams.get('limit'), {
    name: 'limit', min: 1, max: config.MAX_LIMIT, fallback: config.DEFAULT_LIMIT,
  });

  const rawText = searchParams.get('q');
  const text = rawText ? rawText.trim().slice(0, 120) : '';

  return { decade, genre, offset, limit, text };
}

module.exports = { ValidationError, isMbid, parseIntParam, parseAlbumQuery };
