import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlbumCard } from '../lib/types';
import { fetchAlbums, fetchGenres, reportMissingCovers } from './api';

const PAGE_SIZE = 40;

interface Filters {
  decade: number | null;
  genre: string | null;
}

function readFilters(): Filters {
  const p = new URLSearchParams(window.location.search);
  const decadeRaw = p.get('decade');
  const decade = decadeRaw && /^\d+$/.test(decadeRaw) ? Number(decadeRaw) : null;
  const genre = p.get('genre');
  return { decade, genre: genre && genre.trim() ? genre.trim() : null };
}

function writeFilters({ decade, genre }: Filters): void {
  const p = new URLSearchParams();
  if (decade) p.set('decade', String(decade));
  if (genre) p.set('genre', genre);
  const qs = p.toString();
  const next = qs ? `/?${qs}` : '/';
  if (next !== window.location.pathname + window.location.search) {
    window.history.pushState(null, '', next);
  }
}

export function App() {
  const [decades, setDecades] = useState<number[]>([]);
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(() => readFilters());

  const [items, setItems] = useState<AlbumCard[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Release groups whose cover 404'd this session, hidden and reported in a batch.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const missingBuffer = useRef<string[]>([]);

  // Load decade + genre options once.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchGenres(ctrl.signal)
      .then((data) => {
        setDecades(data.decades);
        // Merge the curated recognizable names with the full MusicBrainz list
        // so common genres always surface, deduped and alphabetized.
        const merged = Array.from(new Set([...data.curated, ...data.genres])).sort();
        setGenreOptions(merged);
      })
      .catch(() => {
        /* filters still render from whatever we have */
      });
    return () => ctrl.abort();
  }, []);

  // Keep filters in sync with browser back/forward.
  useEffect(() => {
    const onPop = () => setFilters(readFilters());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Genre is optional: a decade alone browses the whole decade.
  const active = filters.decade !== null;

  // Fetch the first page whenever the active filters change. An AbortController
  // discards stale responses so a slow request can never repopulate the grid
  // after the filters moved on.
  useEffect(() => {
    if (!active) {
      setItems([]);
      setTotal(null);
      setHasMore(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setItems([]);
    setOffset(0);
    fetchAlbums(
      { decade: filters.decade!, genre: filters.genre, offset: 0, limit: PAGE_SIZE },
      ctrl.signal,
    )
      .then((data) => {
        setItems(data.items);
        setOffset(data.nextOffset);
        setHasMore(data.hasMore);
        setTotal(data.total);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [active, filters.decade, filters.genre]);

  const loadMore = useCallback(() => {
    if (!active || loading || !hasMore) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetchAlbums(
      { decade: filters.decade!, genre: filters.genre, offset, limit: PAGE_SIZE },
      ctrl.signal,
    )
      .then((data) => {
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...data.items.filter((i) => !seen.has(i.id))];
        });
        setOffset(data.nextOffset);
        setHasMore(data.hasMore);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      })
      .finally(() => setLoading(false));
  }, [active, loading, hasMore, offset, filters.decade, filters.genre]);

  const onCoverError = useCallback((id: string) => {
    setHidden((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    missingBuffer.current.push(id);
    if (missingBuffer.current.length >= 8) {
      reportMissingCovers(missingBuffer.current.splice(0));
    }
  }, []);

  // Flush any buffered missing-cover reports on unmount.
  useEffect(() => () => reportMissingCovers(missingBuffer.current.splice(0)), []);

  const updateFilters = (next: Filters) => {
    writeFilters(next);
    setFilters(next);
  };

  const visible = items.filter((i) => !hidden.has(i.id));

  return (
    <div className="app">
      <header className="masthead">
        <h1>Album Cover Grid</h1>
        <p className="tagline">Browse cover art by decade and genre.</p>
      </header>

      <form className="filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label className="field">
          <span>Decade</span>
          <select
            value={filters.decade ?? ''}
            onChange={(e) =>
              updateFilters({
                ...filters,
                decade: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">Choose a decade</option>
            {decades.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Genre <span className="optional">(optional)</span></span>
          <input
            list="genre-options"
            value={filters.genre ?? ''}
            placeholder="Any genre"
            onChange={(e) =>
              updateFilters({ ...filters, genre: e.target.value.trim() || null })
            }
          />
          <datalist id="genre-options">
            {genreOptions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>

        {filters.genre !== null && (
          <button
            type="button"
            className="clear-genre"
            onClick={() => updateFilters({ ...filters, genre: null })}
          >
            Any genre
          </button>
        )}
      </form>

      <p className="status" role="status" aria-live="polite">
        {!active
          ? 'Choose a decade to begin. Genre is optional.'
          : loading && visible.length === 0
            ? 'Loading covers…'
            : error
              ? error
              : total !== null
                ? `${visible.length} shown${total ? ` of about ${total} matches` : ''}. ${
                    filters.genre
                      ? 'Genre coverage is community-maintained and never complete.'
                      : 'Results are never presented as complete.'
                  }`
                : ''}
      </p>

      {active && !loading && !error && visible.length === 0 && (
        <p className="empty">
          {total === 0
            ? `No matching albums were found. Try another ${filters.genre ? 'genre or decade' : 'decade'}.`
            : 'Matching albums were found, but no usable front-cover images were available. Try a broader genre or another decade.'}
        </p>
      )}

      <main id="gallery" className="grid" aria-busy={loading}>
        {visible.map((album) => (
          <article className="card" key={album.id}>
            <a href={album.musicBrainzUrl} target="_blank" rel="noreferrer">
              <div className="cover">
                <img
                  src={album.cover.grid}
                  alt={`Cover of ${album.title} by ${album.artist}`}
                  loading="lazy"
                  onError={() => onCoverError(album.id)}
                />
              </div>
              <h2 className="card-title">{album.title}</h2>
              <p className="card-artist">{album.artist}</p>
              {album.year !== null && <p className="card-year">{album.year}</p>}
            </a>
          </article>
        ))}
      </main>

      {active && hasMore && !error && (
        <div className="load-more">
          <button type="button" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      <footer className="attribution">
        <p>Metadata provided by MusicBrainz.</p>
        <p>Cover images provided by the Cover Art Archive and hosted by the Internet Archive.</p>
        <p>Cover images remain copyrighted by their respective owners.</p>
      </footer>
    </div>
  );
}
