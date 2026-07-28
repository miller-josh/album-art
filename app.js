/* Album Cover Grid - browser application.
 *
 * All upstream traffic goes through this app's own API. The browser never
 * calls MusicBrainz directly.
 */

const PAGE_SIZE = 40;
const MAX_PAGES_PER_ACTION = 3; // safety limit when art coverage is poor

/* ----------------------------------------------------------------- state */

const state = {
  decade: null,
  genre: null,
  items: [],
  offset: 0,
  hasMore: false,
  total: 0,
  loadingInitial: false,
  loadingMore: false,
  error: null,
  selectedAlbumId: null,
};

let generation = 0;          // bumped on every filter change
let controller = null;       // aborts the in-flight request
let seenIds = new Set();
let pagesThisAction = 0;
let visibleThisAction = 0;
let missingReports = new Set();
let reportTimer = null;
let allGenres = [];

const el = (id) => document.getElementById(id);

const dom = {
  decade: el('decade'),
  genre: el('genre'),
  genreToggle: el('genre-toggle'),
  genreList: el('genre-listbox'),
  clear: el('clear-filters'),
  divider: el('divider'),
  dividerDecade: el('divider-decade'),
  dividerGenre: el('divider-genre'),
  dividerCount: el('divider-count'),
  status: el('status'),
  grid: el('grid'),
  sentinel: el('sentinel'),
  loadMore: el('load-more'),
  exhaustive: el('exhaustive-note'),
  detail: el('detail'),
  detailClose: el('detail-close'),
  detailImage: el('detail-image'),
  detailTitle: el('detail-title'),
  detailArtist: el('detail-artist'),
  detailDate: el('detail-date'),
  detailType: el('detail-type'),
  detailMatched: el('detail-matched'),
  detailGenres: el('detail-genres'),
  detailGenreList: el('detail-genre-list'),
  detailLink: el('detail-link'),
  detailMbid: el('detail-mbid'),
};

/* ----------------------------------------------------------------- utils */

function titleCase(s) {
  return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function setStatus(message, tone = 'info', retry = false) {
  dom.status.textContent = message || '';
  dom.status.dataset.tone = tone;
  if (retry && message) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn status__retry';
    btn.textContent = 'Try again';
    btn.addEventListener('click', () => runSearch({ reset: true }));
    dom.status.append(' ', btn);
  }
}

/* ------------------------------------------------------------- URL state */

function readUrl() {
  const p = new URLSearchParams(location.search);
  const decade = p.get('decade');
  const genre = p.get('genre');
  return {
    decade: decade && /^\d+$/.test(decade) ? Number(decade) : null,
    genre: genre ? genre.trim() : null,
  };
}

function writeUrl({ replace = false } = {}) {
  const p = new URLSearchParams();
  if (state.decade) p.set('decade', String(state.decade));
  if (state.genre) p.set('genre', state.genre);
  const next = p.toString() ? `${location.pathname}?${p}` : location.pathname;
  if (next === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({ ...readUrl() }, '', next);
}

window.addEventListener('popstate', () => {
  const { decade, genre } = readUrl();
  applyFilters({ decade, genre, fromHistory: true });
});

/* ------------------------------------------------------------ filter UI  */

async function loadFilterOptions() {
  try {
    const res = await fetch('/api/genres');
    const data = await res.json();
    const decades = Array.isArray(data.decades) ? data.decades : [];
    for (const d of decades) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = `${d}s`;
      dom.decade.append(opt);
    }
    // The live MusicBrainz list when it is reachable, the curated list when
    // it is not. Curated names lead so the common choices are on top.
    const curated = data.curated || [];
    const rest = (data.genres || []).filter((g) => !curated.includes(g.toLowerCase()));
    allGenres = [...curated, ...rest];
  } catch {
    allGenres = [];
  }
}

/* combobox ---------------------------------------------------------------- */

let comboOpen = false;
let activeIndex = -1;
let filtered = [];

function openCombo(filterText = '') {
  const needle = filterText.trim().toLowerCase();
  filtered = needle
    ? allGenres.filter((g) => g.toLowerCase().includes(needle)).slice(0, 60)
    : allGenres.slice(0, 60);

  dom.genreList.innerHTML = '';
  if (!filtered.length) {
    const li = document.createElement('li');
    li.className = 'combo__empty';
    li.textContent = 'No matching genre. Press Enter to search for it anyway.';
    dom.genreList.append(li);
  } else {
    filtered.forEach((g, i) => {
      const li = document.createElement('li');
      li.className = 'combo__option';
      li.id = `genre-opt-${i}`;
      li.setAttribute('role', 'option');
      li.textContent = titleCase(g);
      li.setAttribute('aria-selected', String(g === state.genre));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus on the input
        chooseGenre(g);
      });
      dom.genreList.append(li);
    });
  }

  dom.genreList.hidden = false;
  dom.genre.setAttribute('aria-expanded', 'true');
  comboOpen = true;
  setActive(-1);
}

function closeCombo() {
  dom.genreList.hidden = true;
  dom.genre.setAttribute('aria-expanded', 'false');
  dom.genre.removeAttribute('aria-activedescendant');
  comboOpen = false;
  activeIndex = -1;
}

function setActive(index) {
  activeIndex = index;
  const options = [...dom.genreList.querySelectorAll('.combo__option')];
  options.forEach((o, i) => o.classList.toggle('is-active', i === index));
  if (index >= 0 && options[index]) {
    dom.genre.setAttribute('aria-activedescendant', options[index].id);
    options[index].scrollIntoView({ block: 'nearest' });
  } else {
    dom.genre.removeAttribute('aria-activedescendant');
  }
}

function chooseGenre(genre) {
  dom.genre.value = titleCase(genre);
  closeCombo();
  applyFilters({ genre });
}

dom.genre.addEventListener('input', () => openCombo(dom.genre.value));
dom.genre.addEventListener('focus', () => { if (!comboOpen) openCombo(dom.genre.value); });
dom.genre.addEventListener('blur', () => setTimeout(closeCombo, 120));
dom.genreToggle.addEventListener('click', () => {
  if (comboOpen) closeCombo();
  else { dom.genre.focus(); openCombo(''); }
});

dom.genre.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!comboOpen) openCombo(dom.genre.value);
    else setActive(Math.min(activeIndex + 1, filtered.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(Math.max(activeIndex - 1, 0));
  } else if (e.key === 'Home' && comboOpen) {
    e.preventDefault(); setActive(0);
  } else if (e.key === 'End' && comboOpen) {
    e.preventDefault(); setActive(filtered.length - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (comboOpen && activeIndex >= 0) chooseGenre(filtered[activeIndex]);
    else if (dom.genre.value.trim()) chooseGenre(dom.genre.value.trim().toLowerCase());
  } else if (e.key === 'Escape' && comboOpen) {
    e.preventDefault(); closeCombo();
  }
});

dom.decade.addEventListener('change', () => {
  const value = dom.decade.value ? Number(dom.decade.value) : null;
  applyFilters({ decade: value });
});

dom.clear.addEventListener('click', () => {
  dom.genre.value = '';
  dom.decade.value = '';
  applyFilters({ decade: null, genre: null });
});

/* --------------------------------------------------------------- filters */

function applyFilters({ decade, genre, fromHistory = false } = {}) {
  if (decade !== undefined) state.decade = decade;
  if (genre !== undefined) state.genre = genre ? genre.trim().toLowerCase() : null;

  dom.decade.value = state.decade ? String(state.decade) : '';
  if (document.activeElement !== dom.genre || fromHistory) {
    dom.genre.value = state.genre ? titleCase(state.genre) : '';
  }

  if (!fromHistory) writeUrl();
  renderDivider();

  if (state.decade && state.genre) {
    runSearch({ reset: true });
  } else {
    resetGrid();
    setStatus('Choose a decade and a genre to start browsing.');
  }
}

function renderDivider() {
  const hasBoth = Boolean(state.decade && state.genre);
  dom.divider.dataset.state = hasBoth ? 'active' : 'idle';
  dom.dividerDecade.textContent = state.decade ? `${state.decade}s` : '--';
  dom.dividerGenre.textContent = state.genre
    ? titleCase(state.genre)
    : 'Pick a decade and a genre';
  dom.dividerCount.textContent = '';
}

function renderCount() {
  if (!state.decade || !state.genre) return;
  const shown = state.items.filter((i) => !i.hidden).length;
  const parts = [`${shown} shown`];
  if (state.total) parts.push(`${state.total.toLocaleString()} tagged matches`);
  dom.dividerCount.textContent = parts.join('  ·  ');
}

/* ---------------------------------------------------------------- search */

function resetGrid() {
  dom.grid.innerHTML = '';
  state.items = [];
  state.offset = 0;
  state.hasMore = false;
  state.total = 0;
  seenIds = new Set();
  visibleThisAction = 0;
  dom.loadMore.hidden = true;
  dom.exhaustive.hidden = true;
  renderCount();
}

async function runSearch({ reset = false } = {}) {
  if (!state.decade || !state.genre) return;
  if (state.loadingInitial || state.loadingMore) {
    if (!reset) return;
  }

  if (reset) {
    generation += 1;
    pagesThisAction = 0;
    visibleThisAction = 0;
    if (controller) controller.abort();
    resetGrid();
    state.loadingInitial = true;
    setStatus(`Looking for ${titleCase(state.genre)} covers from the ${state.decade}s...`);
  } else {
    state.loadingMore = true;
    dom.loadMore.disabled = true;
  }

  const myGeneration = generation;
  pagesThisAction += 1;
  controller = new AbortController();

  const params = new URLSearchParams({
    decade: String(state.decade),
    genre: state.genre,
    offset: String(state.offset),
    limit: String(PAGE_SIZE),
  });

  try {
    const res = await fetch(`/api/albums?${params}`, { signal: controller.signal });
    const data = await res.json();

    // A response from a superseded filter combination is dropped outright.
    if (myGeneration !== generation) return;

    if (!res.ok) {
      const message = data?.error?.message || 'Something went wrong.';
      state.error = message;
      setStatus(message, 'error', res.status >= 500);
      return;
    }

    state.error = null;
    state.total = data.total || 0;
    state.hasMore = Boolean(data.hasMore);
    state.offset = data.nextOffset ?? state.offset + PAGE_SIZE;

    const fresh = (data.items || []).filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });

    appendCards(fresh, myGeneration);

    if (!state.total) {
      setStatus('No matching albums were found. Try another genre or decade.');
    } else if (!state.items.some((i) => !i.hidden) && !state.hasMore) {
      setStatus('Matching albums were found, but no usable front-cover images were available. Try a broader genre or another decade.');
    } else {
      setStatus('');
    }

    dom.exhaustive.hidden = data.isExhaustive !== false || !state.items.length;
    dom.loadMore.hidden = !state.hasMore;
    renderCount();
  } catch (err) {
    if (err.name === 'AbortError' || myGeneration !== generation) return;
    state.error = 'unavailable';
    setStatus('Album metadata is temporarily unavailable. Please try again.', 'error', true);
  } finally {
    if (myGeneration === generation) {
      state.loadingInitial = false;
      state.loadingMore = false;
      dom.loadMore.disabled = false;
      // Runs only once the flags are clear, otherwise the guard inside
      // maybeBackfill would reject every call.
      if (!state.error) maybeBackfill();
    }
  }
}

/**
 * Poor tag/art coverage can leave a page nearly empty after failed images.
 * Rather than looping, pull at most MAX_PAGES_PER_ACTION upstream pages for a
 * single user action.
 */
function maybeBackfill() {
  if (state.loadingInitial || state.loadingMore) return;
  if (!state.hasMore) return;
  if (pagesThisAction >= MAX_PAGES_PER_ACTION) return;
  if (visibleThisAction >= PAGE_SIZE) return;
  runSearch({ reset: false });
}

/* ------------------------------------------------------------------ cards */

function appendCards(items, myGeneration) {
  const frag = document.createDocumentFragment();

  for (const item of items) {
    state.items.push(item);
    visibleThisAction += 1;

    const li = document.createElement('li');
    li.className = 'card';
    li.dataset.id = item.id;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card__button';
    button.addEventListener('click', () => openDetail(item, button));

    const sleeve = document.createElement('div');
    sleeve.className = 'card__sleeve is-loading';

    const img = document.createElement('img');
    img.className = 'card__img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 500;
    img.height = 500;
    img.alt = `Cover of ${item.title} by ${item.artist}`;
    img.src = item.cover.grid;

    img.addEventListener('load', () => {
      sleeve.classList.remove('is-loading');
      img.classList.add('is-loaded');
    });

    img.addEventListener('error', () => {
      // No usable front cover. Hide the card rather than leaving a broken
      // image, remember it, and top the batch back up if it is now thin.
      if (myGeneration !== generation) return;
      li.hidden = true;
      item.hidden = true;
      visibleThisAction = Math.max(0, visibleThisAction - 1);
      reportMissing(item.id);
      renderCount();
      maybeBackfill();
    });

    sleeve.append(img);

    const text = document.createElement('div');
    text.className = 'card__text';

    const title = document.createElement('p');
    title.className = 'card__title';
    title.textContent = item.title;

    const artist = document.createElement('p');
    artist.className = 'card__artist';
    artist.textContent = item.artist;

    const year = document.createElement('p');
    year.className = 'card__year';
    year.textContent = item.year ? String(item.year) : 'Year unknown';

    text.append(title, artist, year);
    button.append(sleeve, text);
    li.append(button);
    frag.append(li);
  }

  dom.grid.append(frag);
}

/* Batch the missing-art reports so the server learns without a request per card. */
function reportMissing(id) {
  missingReports.add(id);
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const missing = [...missingReports].slice(0, 100);
    missingReports = new Set();
    if (!missing.length) return;
    fetch('/api/cover-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ missing }),
      keepalive: true,
    }).catch(() => {});
  }, 1500);
}

/* ------------------------------------------------------------- pagination */

dom.loadMore.addEventListener('click', () => {
  pagesThisAction = 0;
  visibleThisAction = 0;
  runSearch({ reset: false });
});

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    if (!state.hasMore || state.loadingInitial || state.loadingMore) continue;
    pagesThisAction = 0;
    visibleThisAction = 0;
    runSearch({ reset: false });
  }
}, { rootMargin: '600px 0px' });

observer.observe(dom.sentinel);

/* ----------------------------------------------------------------- detail */

async function openDetail(item, originButton) {
  state.selectedAlbumId = item.id;

  dom.detailTitle.textContent = item.title;
  dom.detailArtist.textContent = item.artist;
  dom.detailDate.textContent = item.firstReleaseDate || (item.year ? String(item.year) : 'Unknown');
  dom.detailType.textContent = [item.primaryType, ...(item.secondaryTypes || [])]
    .filter(Boolean).join(' · ') || 'Unknown';
  dom.detailMatched.textContent = `${titleCase(state.genre)} · ${state.decade}s`;
  dom.detailLink.href = item.musicBrainzUrl;
  dom.detailMbid.textContent = item.id;
  dom.detailImage.src = item.cover.detail;
  dom.detailImage.alt = `Cover of ${item.title} by ${item.artist}`;
  dom.detailGenres.hidden = true;
  dom.detailGenreList.innerHTML = '';

  // <dialog> handles the focus trap, Escape, and focus restoration natively.
  dom.detail.showModal();
  dom.detail.returnFocusTo = originButton;

  try {
    const res = await fetch(`/api/albums/${item.id}`);
    if (!res.ok) return;
    const details = await res.json();
    if (state.selectedAlbumId !== item.id) return;
    const genres = (details.genres || []).slice(0, 12);
    if (genres.length) {
      for (const g of genres) {
        const li = document.createElement('li');
        li.textContent = titleCase(g.name);
        dom.detailGenreList.append(li);
      }
      dom.detailGenres.hidden = false;
    }
  } catch {
    /* Details are enrichment. The card data already on screen still stands. */
  }
}

dom.detailClose.addEventListener('click', () => dom.detail.close());

dom.detail.addEventListener('close', () => {
  state.selectedAlbumId = null;
  dom.detailImage.removeAttribute('src');
  const origin = dom.detail.returnFocusTo;
  if (origin && document.contains(origin)) origin.focus();
});

// Click on the backdrop closes.
dom.detail.addEventListener('click', (e) => {
  if (e.target === dom.detail) dom.detail.close();
});

/* -------------------------------------------------------------- bootstrap */

(async function init() {
  await loadFilterOptions();
  const { decade, genre } = readUrl();
  state.decade = decade;
  state.genre = genre ? genre.toLowerCase() : null;
  dom.decade.value = state.decade ? String(state.decade) : '';
  dom.genre.value = state.genre ? titleCase(state.genre) : '';
  renderDivider();
  writeUrl({ replace: true });

  if (state.decade && state.genre) runSearch({ reset: true });
  else setStatus('Choose a decade and a genre to start browsing.');
})();
