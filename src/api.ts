import type { AlbumsResponse, GenresResponse, ApiErrorBody } from '../lib/types';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // fall through with the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchGenres(signal?: AbortSignal): Promise<GenresResponse> {
  return getJson<GenresResponse>('/api/genres', signal);
}

export function fetchAlbums(
  params: { decade: number; genre: string; offset: number; limit?: number },
  signal?: AbortSignal,
): Promise<AlbumsResponse> {
  const q = new URLSearchParams({
    decade: String(params.decade),
    genre: params.genre,
    offset: String(params.offset),
    limit: String(params.limit ?? 40),
  });
  return getJson<AlbumsResponse>(`/api/albums?${q}`, signal);
}

/** Report release-group MBIDs whose front cover failed to load (PRD 12). */
export function reportMissingCovers(missing: string[]): void {
  if (missing.length === 0) return;
  void fetch('/api/cover-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missing }),
    keepalive: true,
  }).catch(() => {
    // Best-effort; a failed report just means the cover is re-checked later.
  });
}
