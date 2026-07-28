import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from '../lib/config.js';
import * as mb from '../lib/musicbrainz.js';
import { genreCache } from '../lib/cache.js';
import type { GenresResponse } from '../lib/types.js';
import { guarded, methodNotAllowed, sendJson, mapError } from './_http.js';

// GET /api/genres
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (methodNotAllowed(req, res, ['GET', 'HEAD'])) return;
  if (guarded(req, res)) return;

  try {
    // Decades are served alongside the genres so the allowed range has exactly
    // one definition (lib/config.ts) rather than being duplicated in the client.
    const decades = config.allowedDecades();

    const key = 'genres:v1:all';
    const cached = genreCache.get(key);
    if (cached) {
      sendJson(res, 200, { ...cached, decades } satisfies GenresResponse);
      return;
    }

    let body: Omit<GenresResponse, 'decades'>;
    try {
      // The full genre list in one request (fmt=txt), newline-delimited.
      const text = await mb.listGenresText();
      const names = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line.length <= config.MAX_GENRE_LENGTH)
        .sort();
      if (names.length === 0) throw new Error('empty genre list');
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
