import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from './lib/config';

import albums from './api/albums';
import albumDetail from './api/albums/[mbid]';
import genres from './api/genres';
import coverStatus from './api/cover-status';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

/**
 * Minimal local replica of Vercel's file-based routing. Production serves the
 * api/ functions directly; this harness lets the same handlers run under plain
 * Node for local development (npm run dev:api) and for the integration tests.
 */
function route(pathname: string): Handler | null {
  if (pathname === '/api/albums') return albums;
  if (pathname === '/api/genres') return genres;
  if (pathname === '/api/cover-status') return coverStatus;
  if (/^\/api\/albums\/[^/]+$/.test(pathname)) return albumDetail;
  return null;
}

export const server = http.createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`,
    ).pathname;

    const handler = route(pathname);
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }));
      return;
    }

    // The handlers rely only on base Node req/res semantics, so the cast to
    // Vercel's types is safe at runtime.
    Promise.resolve(
      handler(req as unknown as VercelRequest, res as unknown as VercelResponse),
    ).catch((err) => {
      console.error('[dev-server] handler threw:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }));
      }
    });
  },
);

// Only listen when run directly, not when imported by the tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(config.PORT, () => {
    console.log(`Album Cover Grid API running at http://localhost:${config.PORT}`);
    console.log(`MusicBrainz User-Agent: ${config.USER_AGENT}`);
    if (config.CONTACT.includes('example.invalid')) {
      console.warn('\n  Set MB_CONTACT to a real contact URL before deploying.\n');
    }
  });
}
