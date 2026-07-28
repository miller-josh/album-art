import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from '../lib/config';
import * as mb from '../lib/musicbrainz';
import { parseAlbumQuery } from '../lib/validate';
import { buildReleaseGroupQuery, searchCacheKey } from '../lib/query';
import { normalizeSearch } from '../lib/normalize';
import { searchCache, noCoverCache } from '../lib/cache';
import type { AlbumsResponse } from '../lib/types';
import { guarded, methodNotAllowed, parseUrl, sendJson, mapError } from './_http';

// GET /api/albums?decade=&genre=&offset=&limit=&q=
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (methodNotAllowed(req, res, ['GET', 'HEAD'])) return;
  if (guarded(req, res)) return;

  try {
    const params = parseAlbumQuery(parseUrl(req).searchParams);
    const key = searchCacheKey(params);

    let normalized = searchCache.get(key);
    if (!normalized) {
      const query = buildReleaseGroupQuery(params);
      const payload = await mb.searchReleaseGroups({
        query,
        limit: params.limit,
        offset: params.offset,
      });
      normalized = normalizeSearch(payload as Parameters<typeof normalizeSearch>[0]);
      searchCache.set(key, normalized, config.TTL_SEARCH);
    }

    // Apply the negative cover cache at read time so entries learned since the
    // search was cached still take effect.
    const items = normalized.items.filter((item) => !noCoverCache.has(item.id));
    const knownMissing = normalized.items.length - items.length;

    const nextOffset = params.offset + params.limit;
    const hasMore = nextOffset < normalized.total;

    const body: AlbumsResponse = {
      query: {
        decade: params.decade,
        genre: params.genre,
        offset: params.offset,
        limit: params.limit,
        ...(params.text ? { q: params.text } : {}),
      },
      total: normalized.total,
      items,
      knownMissingArt: knownMissing,
      nextOffset,
      hasMore,
      // Tag coverage is community-maintained and some matches lack artwork,
      // so results are never presented as the complete set.
      isExhaustive: false,
    };
    sendJson(res, 200, body);
  } catch (err) {
    mapError(res, err);
  }
}
