import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from '../lib/config.js';
import * as mb from '../lib/musicbrainz.js';
import { parseIntParam } from '../lib/validate.js';
import { genreCache } from '../lib/cache.js';
import type { GenresResponse } from '../lib/types.js';
import { guarded, methodNotAllowed, parseUrl, sendJson, mapError } from './_http.js';

interface RawGenreList {
  genres?: Array<{ name?: string }>;
}

// GET /api/genres?offset=&limit=
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (methodNotAllowed(req, res, ['GET', 'HEAD'])) return;
  if (guarded(req, res)) return;

  try {
    const params = parseUrl(req).searchParams;
    const limit = parseIntParam(params.get('limit'), {
      name: 'limit', min: 1, max: 100, fallback: 100,
    });
    const offset = parseIntParam(params.get('offset'), {
      name: 'offset', min: 0, max: 10_000, fallback: 0,
    });

    // Decades are served alongside the genres so the allowed range has exactly
    // one definition (lib/config.ts) rather than being duplicated in the client.
    const decades = config.allowedDecades();

    const key = `genres:v1:offset=${offset}:limit=${limit}`;
    const cached = genreCache.get(key);
    if (cached) {
      sendJson(res, 200, { ...cached, decades } satisfies GenresResponse);
      return;
    }

    let body: Omit<GenresResponse, 'decades'>;
    try {
      const payload = (await mb.listGenres({ limit, offset })) as RawGenreList;
      const names = (payload?.genres || [])
        .map((g) => g.name)
        .filter((n): n is string => Boolean(n))
        .sort();
      body = { genres: names, curated: config.CURATED_GENRES, source: 'musicbrainz' };
      genreCache.set(key, body, config.TTL_GENRES);
    } catch {
      // The gallery still works from the curated list, so a genre-list outage
      // is degraded rather than fatal.
      body = { genres: [], curated: config.CURATED_GENRES, source: 'curated' };
    }
    sendJson(res, 200, { ...body, decades } satisfies GenresResponse);
  } catch (err) {
    mapError(res, err);
  }
}
