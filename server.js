'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const config = require('./lib/config');
const mb = require('./lib/musicbrainz');
const { ValidationError, isMbid, parseAlbumQuery, parseIntParam } = require('./lib/validate');
const { buildReleaseGroupQuery, searchCacheKey } = require('./lib/query');
const { normalizeSearch, toAlbumDetails } = require('./lib/normalize');
const { searchCache, detailCache, genreCache, noCoverCache } = require('./lib/cache');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

// Simple fixed-window guard so the backend cannot be used as a free proxy.
const ipHits = new Map();
function overRateLimit(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.start >= config.IP_WINDOW_MS) {
    ipHits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > config.IP_MAX_REQUESTS;
}
setInterval(() => {
  const cutoff = Date.now() - config.IP_WINDOW_MS;
  for (const [ip, entry] of ipHits) if (entry.start < cutoff) ipHits.delete(ip);
}, config.IP_WINDOW_MS).unref();

function mapUpstreamError(res, err) {
  if (err instanceof ValidationError) {
    return sendError(res, 400, err.code, err.message);
  }
  if (err?.name === 'UpstreamError') {
    const status = err.status === 404 ? 404 : 502;
    const code = err.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE';
    const message = err.status === 404
      ? 'That album could not be found.'
      : 'Album metadata is temporarily unavailable. Please try again.';
    return sendError(res, status, code, message);
  }
  console.error('[server] unexpected error:', err);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
}

async function readBody(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ValidationError('Request body too large.', 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be JSON.', 'INVALID_BODY');
  }
}

/* ------------------------------------------------------------------ *
 * GET /api/albums
 * ------------------------------------------------------------------ */

async function handleAlbums(req, res, url) {
  const params = parseAlbumQuery(url.searchParams);
  const key = searchCacheKey(params);

  let normalized = searchCache.get(key);
  if (!normalized) {
    const query = buildReleaseGroupQuery(params);
    const payload = await mb.searchReleaseGroups({
      query,
      limit: params.limit,
      offset: params.offset,
    });
    normalized = normalizeSearch(payload);
    searchCache.set(key, normalized, config.TTL_SEARCH);
  }

  // Apply the negative cover cache at read time so entries learned since the
  // search was cached still take effect.
  const items = normalized.items.filter((item) => !noCoverCache.has(item.id));
  const knownMissing = normalized.items.length - items.length;

  const nextOffset = params.offset + params.limit;
  const hasMore = nextOffset < normalized.total;

  sendJson(res, 200, {
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
  });
}

/* ------------------------------------------------------------------ *
 * GET /api/albums/:mbid
 * ------------------------------------------------------------------ */

async function handleAlbumDetail(req, res, mbid) {
  if (!isMbid(mbid)) {
    throw new ValidationError('That album identifier is not valid.', 'INVALID_MBID');
  }
  const key = `detail:v1:${mbid.toLowerCase()}`;
  let details = detailCache.get(key);
  if (!details) {
    const payload = await mb.lookupReleaseGroup(mbid);
    details = toAlbumDetails(payload);
    if (!details) throw new ValidationError('That album could not be found.', 'NOT_FOUND');
    detailCache.set(key, details, config.TTL_DETAIL);
  }
  sendJson(res, 200, details);
}

/* ------------------------------------------------------------------ *
 * GET /api/genres
 * ------------------------------------------------------------------ */

async function handleGenres(req, res, url) {
  const limit = parseIntParam(url.searchParams.get('limit'), {
    name: 'limit', min: 1, max: 100, fallback: 100,
  });
  const offset = parseIntParam(url.searchParams.get('offset'), {
    name: 'offset', min: 0, max: 10_000, fallback: 0,
  });

  // Decades are served alongside the genres so the allowed range has exactly
  // one definition (lib/config.js) rather than being duplicated in the client.
  const decades = config.allowedDecades();

  const key = `genres:v1:offset=${offset}:limit=${limit}`;
  const cached = genreCache.get(key);
  if (cached) return sendJson(res, 200, { ...cached, decades });

  let body;
  try {
    const payload = await mb.listGenres({ limit, offset });
    const names = (payload?.genres || []).map((g) => g.name).filter(Boolean).sort();
    body = { genres: names, curated: config.CURATED_GENRES, source: 'musicbrainz' };
    genreCache.set(key, body, config.TTL_GENRES);
  } catch {
    // The gallery still works from the curated list, so a genre-list outage
    // is degraded rather than fatal.
    body = { genres: [], curated: config.CURATED_GENRES, source: 'curated' };
  }
  sendJson(res, 200, { ...body, decades });
}

/* ------------------------------------------------------------------ *
 * POST /api/cover-status  — browser reports artwork that failed to load
 * ------------------------------------------------------------------ */

async function handleCoverStatus(req, res) {
  const body = await readBody(req);
  const ids = Array.isArray(body?.missing) ? body.missing : [];
  let recorded = 0;
  for (const id of ids.slice(0, 100)) {
    if (!isMbid(id)) continue;
    noCoverCache.set(id, true, config.TTL_NO_COVER);
    recorded += 1;
  }
  sendJson(res, 200, { recorded });
}

/* ------------------------------------------------------------------ *
 * Static files
 * ------------------------------------------------------------------ */

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, rel);
  // Block traversal outside the public directory.
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendError(res, 403, 'FORBIDDEN', 'Not available.');
  }
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    // Any unknown path falls back to the shell so URL filter state survives
    // a direct page load.
    if (!rel.includes('.')) {
      const html = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': html.length });
      return res.end(html);
    }
    sendError(res, 404, 'NOT_FOUND', 'Not found.');
  }
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      if (overRateLimit(clientIp(req))) {
        return sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Slow down and try again.');
      }

      if (req.method === 'GET' && pathname === '/api/albums') {
        return await handleAlbums(req, res, url);
      }
      if (req.method === 'GET' && pathname.startsWith('/api/albums/')) {
        return await handleAlbumDetail(req, res, decodeURIComponent(pathname.slice('/api/albums/'.length)));
      }
      if (req.method === 'GET' && pathname === '/api/genres') {
        return await handleGenres(req, res, url);
      }
      if (req.method === 'POST' && pathname === '/api/cover-status') {
        return await handleCoverStatus(req, res);
      }
      return sendError(res, 404, 'NOT_FOUND', 'No such endpoint.');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
    return await serveStatic(req, res, pathname);
  } catch (err) {
    mapUpstreamError(res, err);
  }
});

if (require.main === module) {
  server.listen(config.PORT, () => {
    console.log(`Album Cover Grid running at http://localhost:${config.PORT}`);
    console.log(`MusicBrainz User-Agent: ${config.USER_AGENT}`);
    if (config.CONTACT.includes('example.invalid')) {
      console.warn('\n  Set MB_CONTACT to a real contact URL before deploying.\n');
    }
  });
}

module.exports = { server };
