'use strict';

const config = require('./config');
const { RateLimiter, sleep } = require('./rate-limiter');

const limiter = new RateLimiter(config.MB_MIN_INTERVAL_MS);

class UpstreamError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function backoffMs(attempt) {
  // 1s, 2s, plus jitter. Actual spacing is still governed by the limiter.
  const base = 1000 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 400);
}

/**
 * GET a MusicBrainz web service path and parse JSON.
 *
 * @param {string} path  e.g. '/release-group'
 * @param {object} params query parameters, `fmt=json` is added automatically
 */
async function mbGet(path, params = {}) {
  const url = new URL(config.MB_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('fmt', 'json');

  let lastError;
  for (let attempt = 1; attempt <= config.MB_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await limiter.schedule(() => fetchOnce(url));
    } catch (err) {
      lastError = err;
      const retryable = err instanceof UpstreamError ? err.retryable : true;
      if (!retryable || attempt === config.MB_MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

async function fetchOnce(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': config.USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(config.MB_TIMEOUT_MS),
    });
  } catch (err) {
    // Network failure or timeout. Both are worth retrying.
    throw new UpstreamError(`MusicBrainz request failed: ${err.message}`, {
      retryable: true,
    });
  }

  if (!res.ok) {
    throw new UpstreamError(`MusicBrainz responded ${res.status}`, {
      status: res.status,
      retryable: RETRYABLE_STATUS.has(res.status),
    });
  }

  try {
    return await res.json();
  } catch {
    throw new UpstreamError('MusicBrainz returned a malformed JSON body', {
      status: res.status,
      retryable: false,
    });
  }
}

function searchReleaseGroups({ query, limit, offset }) {
  return mbGet('/release-group', { query, limit, offset });
}

function lookupReleaseGroup(mbid) {
  return mbGet(`/release-group/${mbid}`, { inc: 'genres' });
}

function listGenres({ limit = 100, offset = 0 } = {}) {
  return mbGet('/genre/all', { limit, offset });
}

module.exports = {
  mbGet,
  searchReleaseGroups,
  lookupReleaseGroup,
  listGenres,
  UpstreamError,
  limiter,
};
