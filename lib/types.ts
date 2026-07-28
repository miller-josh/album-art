// Shared, framework-agnostic types. Safe to import from both the serverless
// API layer and the browser app, since this file contains types only.

/** Normalized release group as rendered by a grid card (PRD 22). */
export interface AlbumCard {
  id: string;
  title: string;
  artist: string;
  firstReleaseDate: string | null;
  year: number | null;
  primaryType: string | null;
  secondaryTypes: string[];
  score: number | null;
  cover: {
    grid: string;
    detail: string;
  };
  musicBrainzUrl: string;
}

/** A matched/associated genre on a release group. */
export interface AlbumGenre {
  id?: string;
  name: string;
  count?: number;
}

/** Album card plus the genres fetched on demand for the detail view (PRD 22). */
export interface AlbumDetails extends AlbumCard {
  genres: AlbumGenre[];
}

/** Shape of `GET /api/albums`. */
export interface AlbumsResponse {
  query: {
    decade: number;
    genre: string;
    offset: number;
    limit: number;
    q?: string;
  };
  total: number;
  items: AlbumCard[];
  knownMissingArt: number;
  nextOffset: number;
  hasMore: boolean;
  isExhaustive: boolean;
}

/** Shape of `GET /api/genres`. */
export interface GenresResponse {
  genres: string[];
  curated: string[];
  source: 'musicbrainz' | 'curated';
  decades: number[];
}

/** Structured error body returned by every API endpoint on failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
