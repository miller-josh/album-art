import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as config from '../lib/config.js';
import { ValidationError } from '../lib/validate.js';
import { UpstreamError } from '../lib/musicbrainz.js';

// These handlers deliberately depend only on the base Node request/response
// semantics (req.url, req.method, req.socket, writeHead/end and the async
// body iterator) rather than Vercel's parsed req.query / req.body. That keeps
// one code path that runs identically under Vercel and under the local
// dev-server harness used by the tests.

export function sendJson(
  res: VercelResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { error: { code, message } });
}

/** Parse the request URL into pathname + search params, host-independent. */
export function parseUrl(req: VercelRequest): URL {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Simple fixed-window guard so the backend cannot be used as a free proxy.
// Per-instance on Vercel; a multi-instance deploy needs a shared store.
const ipHits = new Map<string, { start: number; count: number }>();

function overRateLimit(ip: string): boolean {
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

/**
 * Enforce the per-IP abuse guard. Returns true (and sends 429) when the
 * caller should stop. Call at the top of every API handler.
 */
export function guarded(req: VercelRequest, res: VercelResponse): boolean {
  if (overRateLimit(clientIp(req))) {
    sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Slow down and try again.');
    return true;
  }
  return false;
}

/** Read and JSON-parse a request body, capped in size. */
export async function readBody(
  req: VercelRequest,
  maxBytes = 16 * 1024,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new ValidationError('Request body too large.', 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be JSON.', 'INVALID_BODY');
  }
}

/** Map thrown errors to the appropriate structured HTTP response. */
export function mapError(res: VercelResponse, err: unknown): void {
  if (err instanceof ValidationError) {
    sendError(res, 400, err.code, err.message);
    return;
  }
  if (err instanceof UpstreamError) {
    const status = err.status === 404 ? 404 : 502;
    const code = err.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE';
    const message =
      err.status === 404
        ? 'That album could not be found.'
        : 'Album metadata is temporarily unavailable. Please try again.';
    sendError(res, status, code, message);
    return;
  }
  console.error('[api] unexpected error:', err);
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
}

/** Reject any method not in `allowed`, sending a 405. Returns true if rejected. */
export function methodNotAllowed(
  req: VercelRequest,
  res: VercelResponse,
  allowed: string[],
): boolean {
  if (allowed.includes(req.method || 'GET')) return false;
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  return true;
}
