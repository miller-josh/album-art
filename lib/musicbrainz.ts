import * as config from './config.js';
import { RateLimiter, sleep } from './rate-limiter.js';

const limiter = new RateLimiter(config.MB_MIN_INTERVAL_MS);

interface UpstreamErrorOptions {
  status?: number | null;
  retryable?: boolean;
}

export class UpstreamError extends Error {
  status: number | null;
  retryable: boolean;
  constructor(message: string, { status = null, retryable = false }: UpstreamErrorOptions = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function backoffMs(attempt: number): number {
  // 1s, 2s, plus jitter. Actual spacing is still governed by the limiter.
  const base = 1000 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 400);
}

type QueryParams = Record<string, string | number | undefined | null>;

/**
 * GET a MusicBrainz web service path and parse JSON.
 *
 * @param path   e.g. '/release-group'
 * @param params query parameters, `fmt=json` is added automatically
 */
export async function mbGet<T = unknown>(path: string, params: QueryParams = {}): Promise<T> {
  const url = new URL(config.MB_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('fmt', 'json');

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.MB_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await limiter.schedule(() => fetchOnce<T>(url));
    } catch (err) {
      lastError = err;
      const retryable = err instanceof UpstreamError ? err.retryable : true;
      if (!retryable || attempt === config.MB_MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

async function fetchOnce<T>(url: URL): Promise<T> {
  let res: Response;
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
    throw new UpstreamError(`MusicBrainz request failed: ${(err as Error).message}`, {
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
    return (await res.json()) as T;
  } catch {
    throw new UpstreamError('MusicBrainz returned a malformed JSON body', {
      status: res.status,
      retryable: false,
    });
  }
}

export function searchReleaseGroups({
  query,
  limit,
  offset,
}: {
  query: string;
  limit: number;
  offset: number;
}): Promise<unknown> {
  return mbGet('/release-group', { query, limit, offset });
}

export function lookupReleaseGroup(mbid: string): Promise<unknown> {
  return mbGet(`/release-group/${mbid}`, { inc: 'genres' });
}

export function listGenres({ limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<unknown> {
  return mbGet('/genre/all', { limit, offset });
}

export { limiter };
