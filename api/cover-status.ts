import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from '../lib/config.js';
import { isMbid } from '../lib/validate.js';
import { noCoverCache } from '../lib/cache.js';
import { guarded, methodNotAllowed, readBody, sendJson, mapError } from './_http.js';

// POST /api/cover-status — the browser reports MBIDs whose artwork 404'd,
// which is the only way to populate the negative cover cache (PRD 12).
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (methodNotAllowed(req, res, ['POST'])) return;
  if (guarded(req, res)) return;

  try {
    const body = await readBody(req);
    const ids = Array.isArray(body?.missing) ? body.missing : [];
    let recorded = 0;
    for (const id of ids.slice(0, 100)) {
      if (!isMbid(id)) continue;
      noCoverCache.set(id, true, config.TTL_NO_COVER);
      recorded += 1;
    }
    sendJson(res, 200, { recorded });
  } catch (err) {
    mapError(res, err);
  }
}
