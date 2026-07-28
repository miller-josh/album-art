'use strict';

/**
 * In-process TTL cache with an entry cap.
 *
 * Deliberately swappable: for a horizontally scaled deployment replace this
 * with Redis so throttling and caching are coordinated across instances.
 */
class TtlCache {
  constructor({ maxEntries = 2000 } = {}) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
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

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, value, ttlMs) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  get size() {
    return this.map.size;
  }
}

const searchCache = new TtlCache({ maxEntries: 1000 });
const detailCache = new TtlCache({ maxEntries: 2000 });
const genreCache = new TtlCache({ maxEntries: 4 });

/**
 * Release groups known to have no usable front cover. Populated by the
 * browser reporting image failures, so a filtered view does not re-request
 * the same missing artwork on every visit.
 */
const noCoverCache = new TtlCache({ maxEntries: 20_000 });

module.exports = { TtlCache, searchCache, detailCache, genreCache, noCoverCache };
