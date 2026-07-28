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

function buildUrl(path: string, params: QueryParams, defaultFmt: string): URL {
  const url = new URL(config.MB_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  if (!url.searchParams.has('fmt')) url.searchParams.set('fmt', defaultFmt);
  return url;
}

/**
 * Fetch a MusicBrainz URL through the shared rate limiter, retrying transient
 * failures, and parse the body with `parse`. `accept` sets the Accept header.
 */
async function request<T>(
  url: URL,
  accept: string,
  parse: (res: Response) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.MB_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await limiter.schedule(() => fetchOnce(url, accept, parse));
    } catch (err) {
      lastError = err;
      const retryable = err instanceof UpstreamError ? err.retryable : true;
      if (!retryable || attempt === config.MB_MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

async function fetchOnce<T>(
  url: URL,
  accept: string,
  parse: (res: Response) => Promise<T>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': config.USER_AGENT,
        Accept: accept,
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
    return await parse(res);
  } catch {
    throw new UpstreamError('MusicBrainz returned a malformed body', {
      status: res.status,
      retryable: false,
    });
  }
}

/** GET a MusicBrainz path and parse JSON (`fmt=json` added automatically). */
export function mbGet<T = unknown>(path: string, params: QueryParams = {}): Promise<T> {
  return request<T>(buildUrl(path, params, 'json'), 'application/json', (r) => r.json() as Promise<T>);
}

/** GET a MusicBrainz path as plain text (`fmt=txt` added automatically). */
export function mbGetText(path: string, params: QueryParams = {}): Promise<string> {
  return request<string>(buildUrl(path, params, 'txt'), 'text/plain', (r) => r.text());
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

/**
 * The complete MusicBrainz genre list, as a newline-delimited plain-text body.
 * The `fmt=txt` variant of /genre/all returns every genre in one response, so
 * we avoid paginating ~2000 genres one throttled request at a time.
 */
export function listGenresText(): Promise<string> {
  return mbGetText('/genre/all');
}

export { limiter };
