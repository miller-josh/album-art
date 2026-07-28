import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from '../../lib/config';
import * as mb from '../../lib/musicbrainz';
import { isMbid, ValidationError } from '../../lib/validate';
import { toAlbumDetails } from '../../lib/normalize';
import { detailCache } from '../../lib/cache';
import { guarded, methodNotAllowed, parseUrl, sendJson, mapError } from '../_http';

// GET /api/albums/:mbid — release-group detail with genres, fetched on demand.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (methodNotAllowed(req, res, ['GET', 'HEAD'])) return;
  if (guarded(req, res)) return;

  try {
    // Take the MBID from the path rather than Vercel's parsed query so the
    // same handler works under the local dev harness.
    const segments = parseUrl(req).pathname.split('/').filter(Boolean);
    const mbid = decodeURIComponent(segments[segments.length - 1] || '');

    if (!isMbid(mbid)) {
      throw new ValidationError('That album identifier is not valid.', 'INVALID_MBID');
    }

    const key = `detail:v1:${mbid.toLowerCase()}`;
    let details = detailCache.get(key);
    if (!details) {
      const payload = await mb.lookupReleaseGroup(mbid);
      const built = toAlbumDetails(payload as Parameters<typeof toAlbumDetails>[0]);
      if (!built) throw new ValidationError('That album could not be found.', 'NOT_FOUND');
      details = built;
      detailCache.set(key, details, config.TTL_DETAIL);
    }
    sendJson(res, 200, details);
  } catch (err) {
    mapError(res, err);
  }
}
