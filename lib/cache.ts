/**
 * In-process TTL cache with an entry cap.
 *
 * Deliberately swappable: for a horizontally scaled deployment replace this
 * with Redis so throttling and caching are coordinated across instances.
 */
interface Entry<V> {
  value: V;
  expires: number;
}

export class TtlCache<V = unknown> {
  private maxEntries: number;
  private map = new Map<string, Entry<V>>();

  constructor({ maxEntries = 2000 }: { maxEntries?: number } = {}) {
    this.maxEntries = maxEntries;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU-ish eviction below.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V, ttlMs: number): V {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

import type { NormalizedSearch } from './normalize.js';
import type { AlbumDetails, GenresResponse } from './types.js';

export const searchCache = new TtlCache<NormalizedSearch>({ maxEntries: 1000 });
export const detailCache = new TtlCache<AlbumDetails>({ maxEntries: 2000 });
export const genreCache = new TtlCache<Omit<GenresResponse, 'decades'>>({ maxEntries: 4 });

/**
 * Release groups known to have no usable front cover. Populated by the
 * browser reporting image failures, so a filtered view does not re-request
 * the same missing artwork on every visit.
 */
export const noCoverCache = new TtlCache<boolean>({ maxEntries: 20_000 });
