import { createOptimizedPicture, loadCSS } from '../../scripts/aem.js';

/**
 * Load widget copy from the widget's local JSON (same name as the script).
 * @param {string} lang - Language key (e.g. en)
 * @returns {Promise<Object>} Copy for that language (flat key-value)
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return {};
    const data = await resp.json();
    const key = data[lang] ? lang : 'en';
    return data[key] || {};
  } catch (_) {
    return {};
  }
}

/**
 * Resolve the current site locale from the URL path or document language.
 * @returns {string} Locale code (e.g. en, fr)
 */
function getLocale() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  if (segment && /^[a-z]{2}(-[a-z]{2})?$/i.test(segment)) {
    return segment.split('-')[0].toLowerCase();
  }
  return (document.documentElement.lang || 'en').split('-')[0].toLowerCase();
}

/**
 * Normalize a single item from the query index.
 * @param {Object} row - Raw row from query-index.json
 * @returns {Object} Normalized search item
 */
function normalizeItem(row) {
  const path = row.path || row.url || '';
  return {
    path,
    title: (row.title || '').trim(),
    description: (row.description || '').trim(),
    image: row.image || '',
  };
}

/**
 * Fetch and cache the locale-specific query index.
 * @param {string} [locale] - Locale code (defaults to current page locale)
 * @returns {Promise<Array<Object>>} Normalized items
 */
async function loadSearchIndex(locale = getLocale()) {
  window.searchResultsIndexByLocale = window.searchResultsIndexByLocale || {};
  if (window.searchResultsIndexByLocale[locale]) {
    return window.searchResultsIndexByLocale[locale];
  }

  window.searchResultsIndexPromises = window.searchResultsIndexPromises || {};
  if (!window.searchResultsIndexPromises[locale]) {
    window.searchResultsIndexPromises[locale] = (async () => {
      const base = window.hlx?.codeBasePath || '';
      try {
        const resp = await fetch(`${base}/${locale}/query-index.json`);
        if (!resp.ok) {
          window.searchResultsIndexByLocale[locale] = [];
          return [];
        }
        const json = await resp.json();
        const rows = Array.isArray(json.data) ? json.data : [];
        const items = rows.map(normalizeItem).filter((item) => item.path);
        window.searchResultsIndexByLocale[locale] = items;
        return items;
      } catch (_) {
        window.searchResultsIndexByLocale[locale] = [];
        return [];
      }
    })();
  }

  return window.searchResultsIndexPromises[locale];
}

/**
 * Remove diacritical marks for accent-insensitive matching.
 * @param {string} str - Input string
 * @returns {string}
 */
function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Normalize string for search: lowercase and remove accents.
 * @param {string} str - Input string
 * @returns {string}
 */
function normalizeForSearch(str) {
  return removeAccents((str || '').toLowerCase());
}

/**
 * Split a search string into normalized terms.
 * @param {string} searchTerm - Raw user input
 * @returns {string[]}
 */
function parseSearchTerms(searchTerm) {
  if (!searchTerm || !searchTerm.trim()) return [];
  return searchTerm.trim().split(/\s+/).map((term) => normalizeForSearch(term)).filter(Boolean);
}

/**
 * Original (display) terms from a search string.
 * @param {string} searchTerm - Raw user input
 * @returns {string[]}
 */
function parseDisplayTerms(searchTerm) {
  if (!searchTerm || !searchTerm.trim()) return [];
  return searchTerm.trim().split(/\s+/).filter(Boolean);
}

/**
 * Whether a single normalized term matches any searchable field on an item.
 * @param {Object} item - Normalized search item
 * @param {string} termNorm - Normalized search term
 * @returns {boolean}
 */
function termMatchesItem(item, termNorm) {
  const fields = [item.title, item.description];
  return fields.some((field) => normalizeForSearch(field || '').includes(termNorm));
}

/**
 * Filter index by search term (accent-insensitive).
 * @param {Array<Object>} index - Normalized items
 * @param {string} searchTerm - Search string
 * @returns {Array<Object>} Filtered items with match info
 */
function filterBySearch(index, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    return index.map((item) => ({ ...item, searchTerm: '', searchTerms: [] }));
  }

  const terms = parseSearchTerms(searchTerm);
  const displayTerms = parseDisplayTerms(searchTerm);

  return index.filter((item) => terms.every((term) => termMatchesItem(item, term)))
    .map((item) => ({
      ...item,
      searchTerm: searchTerm.trim().toLowerCase(),
      searchTerms: displayTerms,
    }));
}

/**
 * Whether an item has a usable image.
 * @param {Object} item - Normalized search item
 * @returns {boolean}
 */
function hasImage(item) {
  const image = item?.image?.trim();
  if (!image || !image.startsWith('https://')) return false;
  if (image.toLowerCase().startsWith('data:')) return false;
  return !image.includes('default-meta-image');
}

/**
 * Sort key for a single term against an item.
 * @param {Object} item - Normalized search item
 * @param {string} termNorm - Normalized search term
 * @returns {number[]}
 */
function getTermSortKey(item, termNorm) {
  const titleNorm = normalizeForSearch(item.title || '');
  const descNorm = normalizeForSearch(item.description || '');
  const titleIdx = titleNorm.indexOf(termNorm);
  const descIdx = descNorm.indexOf(termNorm);
  if (titleIdx !== -1) return [0, titleIdx];
  if (descIdx !== -1) return [1, descIdx];
  return [2, Number.MAX_SAFE_INTEGER];
}

/**
 * Sort by relevance: title match before description match.
 * Items with an image rank before those without.
 * @param {Array<Object>} results - Filtered results
 * @param {string} searchTerm - Search string
 */
function sortByRelevance(results, searchTerm) {
  const imageRank = (item) => (hasImage(item) ? 0 : 1);

  if (!searchTerm || !searchTerm.trim()) {
    results.sort((a, b) => imageRank(a) - imageRank(b));
    return;
  }

  const terms = parseSearchTerms(searchTerm);
  results.sort((a, b) => {
    const keyA = terms.flatMap((term) => getTermSortKey(a, term));
    const keyB = terms.flatMap((term) => getTermSortKey(b, term));
    const len = Math.max(keyA.length, keyB.length);
    for (let i = 0; i < len; i += 1) {
      const diff = (keyA[i] ?? 0) - (keyB[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return imageRank(a) - imageRank(b);
  });
}

/**
 * Build a map from normalized index to original string index.
 * @param {string} original - Original text
 * @returns {number[]} normalizedIndex → originalIndex
 */
function getNormalizedToOriginalMap(original) {
  const map = [];
  for (let i = 0; i < original.length; i += 1) {
    const norm = removeAccents(original[i]);
    for (let j = 0; j < norm.length; j += 1) map.push(i);
  }
  return map;
}

/**
 * Escape a plain-text string for safe insertion into HTML.
 * @param {string} str - Raw string
 * @returns {string} HTML-safe string
 */
function escapeHTML(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Highlight matching substrings in text for multiple search terms.
 * @param {string} text - Full text
 * @param {string[]} terms - Terms to highlight
 * @returns {string} HTML with `mark` elements wrapping matched substrings
 */
function highlightTerms(text, terms) {
  if (!text || !terms?.length) return escapeHTML(text);

  const intervals = [];
  terms.forEach((term) => {
    const termNorm = normalizeForSearch(term);
    if (!termNorm) return;
    const textNorm = normalizeForSearch(text);
    const map = getNormalizedToOriginalMap(text);
    let start = 0;
    while (start < textNorm.length) {
      const idx = textNorm.indexOf(termNorm, start);
      if (idx === -1) break;
      const origStart = map[idx];
      const endIdx = idx + termNorm.length - 1;
      const origEnd = endIdx < map.length ? map[endIdx] + 1 : text.length;
      intervals.push([origStart, origEnd]);
      start = idx + termNorm.length;
    }
  });

  if (!intervals.length) return escapeHTML(text);

  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i += 1) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1]) {
      last[1] = Math.max(last[1], intervals[i][1]);
    } else {
      merged.push(intervals[i]);
    }
  }

  let result = '';
  let pos = 0;
  merged.forEach(([start, end]) => {
    result += escapeHTML(text.substring(pos, start));
    result += `<mark>${escapeHTML(text.substring(start, end))}</mark>`;
    pos = end;
  });
  result += escapeHTML(text.substring(pos));
  return result;
}

/**
 * Build a media wrapper with an optimized picture when available.
 * @param {Object} item - Normalized search item
 * @param {number} [width=120] - Pixel width hint
 * @returns {HTMLElement|null}
 */
function createMediaWrapper(item, width = 120) {
  if (!hasImage(item)) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'media-wrapper';
  wrapper.appendChild(createOptimizedPicture(item.image, '', false, [{ width }]));
  return wrapper;
}

/**
 * Create a result card for the search results list.
 * @param {Object} item - Normalized search item
 * @returns {HTMLElement}
 */
function createResultCard(item) {
  const li = document.createElement('li');
  li.className = 'result';

  const media = createMediaWrapper(item);
  if (media) li.appendChild(media);

  const body = document.createElement('div');
  body.className = 'body-wrapper';

  const titleText = item.title || '';
  if (titleText) {
    const heading = document.createElement('p');
    heading.className = 'title';
    const link = document.createElement('a');
    link.href = item.path || '#';
    link.className = 'link';
    link.innerHTML = item.searchTerms?.length
      ? highlightTerms(titleText, item.searchTerms)
      : escapeHTML(titleText);
    heading.appendChild(link);
    body.appendChild(heading);
  }

  const descText = (item.description || '').trim();
  if (descText) {
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.innerHTML = item.searchTerms?.length
      ? highlightTerms(descText, item.searchTerms)
      : escapeHTML(descText);
    body.appendChild(desc);
  }

  li.appendChild(body);
  return li;
}

/**
 * Create a compact suggestions result row.
 * @param {Object} item - Normalized search item
 * @returns {HTMLElement}
 */
function createSuggestionsItem(item) {
  const li = document.createElement('li');
  li.className = 'result';

  const media = createMediaWrapper(item, 88);
  if (media) li.appendChild(media);

  const bodyWrapper = document.createElement('div');
  bodyWrapper.className = 'body-wrapper';

  const titleEl = document.createElement('p');
  titleEl.className = 'title';
  const link = document.createElement('a');
  link.href = item.path || '#';
  link.className = 'link';
  const titleText = item.title || '';
  link.innerHTML = item.searchTerms?.length
    ? highlightTerms(titleText, item.searchTerms)
    : escapeHTML(titleText);
  titleEl.appendChild(link);
  bodyWrapper.appendChild(titleEl);

  const descText = (item.description || '').trim();
  if (descText) {
    const meta = document.createElement('p');
    meta.className = 'meta';
    const excerpt = descText.length > 100 ? `${descText.slice(0, 100)}…` : descText;
    meta.innerHTML = item.searchTerms?.length
      ? highlightTerms(excerpt, item.searchTerms)
      : escapeHTML(excerpt);
    bodyWrapper.appendChild(meta);
  }

  li.appendChild(bodyWrapper);
  return li;
}

/**
 * Read filter config from URL query params.
 * @returns {Object}
 */
function getConfigFromURL() {
  const params = new URLSearchParams(window.location.search);
  const config = {};
  params.forEach((value, key) => { config[key] = value; });
  return config;
}

/**
 * Update URL with current filter state.
 * @param {Object} filterConfig - Current filter values
 */
function updateURL(filterConfig) {
  const params = new URLSearchParams();
  Object.keys(filterConfig).forEach((key) => {
    if (key === 'page' && filterConfig[key] === 1) return;
    const val = filterConfig[key];
    if (val && (typeof val !== 'string' || val.trim())) {
      if (key !== 'page' || val !== 1) params.set(key, val);
    }
  });
  const newURL = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.pushState({ filterConfig }, '', newURL);
}

/**
 * Run a filtered, sorted search against the index.
 * @param {string} searchTerm - Raw user input
 * @param {number} [limit] - Optional maximum number of results
 * @returns {Promise<Array<Object>>}
 */
async function searchItems(searchTerm, limit) {
  const index = await loadSearchIndex();
  const results = filterBySearch(index, searchTerm);
  sortByRelevance(results, searchTerm);
  return limit ? results.slice(0, limit) : results;
}

/**
 * Hydrate all [data-copy] elements from widget copy.
 * @param {HTMLElement} container - .search root element
 * @param {Object} copy - Widget copy for the current language
 */
function hydrateCopy(container, copy) {
  container.querySelectorAll('[data-copy]').forEach((el) => {
    const value = copy[el.dataset.copy];
    if (!value) return;
    const target = el.dataset.copyTarget;
    if (target) {
      target.split(',').forEach((attr) => el.setAttribute(attr.trim(), value));
    } else el.textContent = value;
  });
}

const ITEMS_PER_PAGE = 16;
const SUGGESTIONS_DEBOUNCE_MS = 150;

let searchResultsContainer = null;
let headerSearchInput = document.getElementById('header-search')
  || window.hlx?.headerSearch;
let suggestionsDestroy = null;

/**
 * Whether the page includes a search results widget.
 * @returns {boolean}
 */
function pageHasSearchWidget() {
  if (searchResultsContainer) return true;
  return !!document.querySelector(
    '.widget.search, .search.widget, .widget a[href*="/widgets/search/"]',
  );
}

/**
 * Tear down the header suggestions overlay if active.
 */
function destroySuggestions() {
  if (suggestionsDestroy) {
    suggestionsDestroy();
    suggestionsDestroy = null;
  }
}

/**
 * Render one page of results into the list element.
 * @param {HTMLElement} element - .results list element
 * @param {Array<Object>} results - Full filtered result set
 * @param {number} page - Page number (1-based)
 */
function displayResults(element, results, page) {
  element.innerHTML = '';
  const start = (page - 1) * ITEMS_PER_PAGE;
  results.slice(start, start + ITEMS_PER_PAGE)
    .forEach((item) => element.append(createResultCard(item)));
}

/**
 * Render pagination controls into the nav element.
 * @param {HTMLElement} element - .pagination nav element
 * @param {number} totalResults - Total number of results
 * @param {number} page - Current page number (1-based)
 */
function displayPagination(element, totalResults, page) {
  if (!element) return;
  const pageNum = parseInt(page, 10) || 1;
  const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);
  const prevBtn = element.querySelector('button:first-child');
  const nextBtn = element.querySelector('button:last-child');
  const pagesList = element.querySelector('ol');

  pagesList.innerHTML = '';

  if (totalPages <= 1) {
    element.hidden = true;
    return;
  }

  element.hidden = false;

  prevBtn.disabled = pageNum <= 1;
  if (pageNum > 1) prevBtn.dataset.page = pageNum - 1;
  else delete prevBtn.dataset.page;

  nextBtn.disabled = pageNum >= totalPages;
  if (pageNum < totalPages) nextBtn.dataset.page = pageNum + 1;
  else delete nextBtn.dataset.page;

  const ellipsis = () => {
    const li = document.createElement('li');
    li.classList.add('ellipsis');
    li.setAttribute('aria-hidden', true);
    li.textContent = '…';
    return li;
  };

  const pageItem = (num, current = false) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button secondary';
    btn.textContent = num;
    btn.dataset.page = num;
    if (current) btn.setAttribute('aria-current', 'page');
    li.appendChild(btn);
    return li;
  };

  if (pageNum > 3) {
    pagesList.appendChild(pageItem(1));
    if (pageNum > 4) pagesList.appendChild(ellipsis());
  }
  for (let i = Math.max(1, pageNum - 2); i <= Math.min(totalPages, pageNum + 2); i += 1) {
    pagesList.appendChild(pageItem(i, i === pageNum));
  }
  if (pageNum < totalPages - 2) {
    if (pageNum < totalPages - 3) pagesList.appendChild(ellipsis());
    pagesList.appendChild(pageItem(totalPages));
  }
}

/**
 * Wire search, pagination, and URL state to the container.
 * Uses the header search input instead of an in-widget search box.
 * @param {HTMLElement} container - .search root
 * @param {HTMLInputElement} searchElement - Header search input
 * @param {Object} config - Initial config
 */
function buildSearchFiltering(container, searchElement, config = {}) {
  if (!searchElement) return;

  let currentPage = 1;
  const resultsElement = container.querySelector('.results');
  const infoElement = container.querySelector('.info');
  const queryElement = container.querySelector('#results-query');
  const paginationElement = container.querySelector('.pagination');
  const promptElement = container.querySelector('.search-prompt');
  const noResultsElement = container.querySelector('.no-results');

  const showEmptyState = () => {
    resultsElement.innerHTML = '';
    if (paginationElement) {
      paginationElement.querySelector('ol').innerHTML = '';
      paginationElement.hidden = true;
    }
    if (infoElement) infoElement.hidden = true;
    if (noResultsElement) noResultsElement.hidden = true;
    if (promptElement) promptElement.hidden = false;
  };

  const createFilterConfig = (resetPage = true) => {
    const filterConfig = { ...config };
    filterConfig.search = searchElement.value;
    filterConfig.page = resetPage ? 1 : currentPage;
    if (resetPage) currentPage = 1;
    return filterConfig;
  };

  const runSearch = async (filterConfig = config, updateURLState = true) => {
    const query = (filterConfig.search || '').trim();
    if (!query) {
      showEmptyState();
      if (updateURLState) updateURL({ search: '', page: 1 });
      return;
    }

    if (promptElement) promptElement.hidden = true;
    const results = await searchItems(query);

    const page = parseInt(filterConfig.page, 10) || 1;
    currentPage = page;

    const totalResults = results.length;
    const startNum = totalResults > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
    const endNum = Math.min(page * ITEMS_PER_PAGE, totalResults);

    const hasResults = totalResults > 0;
    if (infoElement) infoElement.hidden = !hasResults;
    if (noResultsElement) noResultsElement.hidden = hasResults;
    if (queryElement) queryElement.textContent = query;
    container.querySelector('#results-start').textContent = startNum;
    container.querySelector('#results-end').textContent = endNum;

    displayResults(resultsElement, results, page);
    if (page > 1) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    displayPagination(paginationElement, totalResults, page);

    if (updateURLState) updateURL(filterConfig);
  };

  searchElement.addEventListener('input', () => runSearch(createFilterConfig(true)));

  if (paginationElement) {
    paginationElement.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      currentPage = parseInt(btn.dataset.page, 10);
      runSearch(createFilterConfig(false));
    });
  }

  const urlConfig = getConfigFromURL();
  const initialConfig = { ...config, ...urlConfig };
  if (urlConfig.page) currentPage = parseInt(urlConfig.page, 10);
  if (urlConfig.search) searchElement.value = urlConfig.search;

  loadSearchIndex();

  if (initialConfig.search?.trim()) {
    runSearch(initialConfig);
  } else {
    showEmptyState();
  }

  window.addEventListener('popstate', (e) => {
    if (e.state?.filterConfig) {
      const saved = e.state.filterConfig;
      if (saved.search !== undefined) searchElement.value = saved.search || '';
      if (saved.page) currentPage = parseInt(saved.page, 10);
      runSearch(saved, false);
    }
  });
}

/**
 * Wire the search results widget once both the widget and header input exist.
 */
function tryWireSearchResults() {
  if (!searchResultsContainer || !headerSearchInput) return;
  if (searchResultsContainer.dataset.searchWired === 'true') return;
  searchResultsContainer.dataset.searchWired = 'true';
  destroySuggestions();
  buildSearchFiltering(searchResultsContainer, headerSearchInput, {});
}

document.addEventListener('header-search-ready', (e) => {
  headerSearchInput = e.detail.input;
  if (pageHasSearchWidget()) {
    tryWireSearchResults();
  }
});

/**
 * Attach suggestions search to an input, loading on first interaction.
 * @param {HTMLInputElement} input - Search input element
 * @param {Object} [options]
 * @param {HTMLElement} [options.anchor] - Element to align overlay with
 * @param {string} [options.resultsPath='/search'] - Full results page path
 * @param {number} [options.maxResults=8] - Max suggestions shown
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function attachSearchSuggestions(input, opts = {}) {
  if (input.dataset.searchSuggestions === 'true') {
    return { destroy: () => {} };
  }
  input.dataset.searchSuggestions = true;

  const {
    anchor = input.closest('form') || input.parentElement,
    resultsPath = '/search',
    maxResults = 8,
  } = opts;

  if (!anchor) {
    return { destroy: () => {} };
  }

  await loadCSS(`${window.hlx?.codeBasePath || ''}/widgets/search/suggestions.css`);

  const lang = (document.documentElement.lang || 'en').split('-')[0];
  const copy = await loadWidgetCopy(lang);

  const overlay = document.createElement('div');
  overlay.id = 'search-suggestions';
  overlay.className = 'search suggestions';
  overlay.hidden = true;

  const list = document.createElement('ul');
  list.className = 'results';
  overlay.appendChild(list);

  const footer = document.createElement('footer');
  const viewAll = document.createElement('a');
  viewAll.classList.add('button', 'primary');
  viewAll.textContent = copy.viewAllResults || 'View all results';
  footer.appendChild(viewAll);
  overlay.appendChild(footer);

  anchor.classList.add('search-suggestions-anchor');
  anchor.appendChild(overlay);

  let debounceTimer;

  const getFocusableLinks = () => [
    ...list.querySelectorAll('.link'),
    ...(viewAll.href ? [viewAll] : []),
  ];

  const updateViewAllHref = (query) => {
    viewAll.href = query
      ? `${resultsPath}?search=${encodeURIComponent(query)}`
      : resultsPath;
  };

  const hideOverlay = () => {
    overlay.hidden = true;
  };

  const showOverlay = () => {
    overlay.hidden = false;
  };

  const renderResults = async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      list.innerHTML = '';
      hideOverlay();
      return;
    }

    const results = await searchItems(trimmed, maxResults);
    list.innerHTML = '';

    if (!results.length) {
      const empty = document.createElement('li');
      empty.className = 'no-results';
      empty.textContent = copy.noResults || 'No results found';
      list.appendChild(empty);
    } else {
      results.forEach((item) => list.appendChild(createSuggestionsItem(item)));
    }

    updateViewAllHref(trimmed);
    showOverlay();
  };

  const scheduleSearch = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderResults(input.value), SUGGESTIONS_DEBOUNCE_MS);
  };

  const onDocumentClick = (e) => {
    if (anchor.contains(e.target)) return;
    hideOverlay();
  };

  const navigate = (e, links) => {
    const current = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      links[current < links.length - 1 ? current + 1 : 0]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (current <= 0) input.focus();
      else links[current - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideOverlay();
      input.focus();
    } else if (e.key === 'Tab') {
      hideOverlay();
    }
  };

  const onInputKeydown = (e) => {
    if (overlay.hidden) return;
    const links = getFocusableLinks();
    if (!links.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      links[0].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideOverlay();
    } else if (e.key === 'Tab') {
      hideOverlay();
    }
  };

  const onOverlayKeydown = (e) => navigate(e, getFocusableLinks());

  const onInputFocus = () => {
    if (list.children.length) showOverlay();
  };

  input.addEventListener('focus', onInputFocus);
  input.addEventListener('input', scheduleSearch);
  input.addEventListener('keydown', onInputKeydown);
  overlay.addEventListener('keydown', onOverlayKeydown);
  document.addEventListener('click', onDocumentClick);

  if (input.value.trim()) renderResults(input.value);

  const destroy = () => {
    clearTimeout(debounceTimer);
    input.removeEventListener('focus', onInputFocus);
    input.removeEventListener('input', scheduleSearch);
    input.removeEventListener('keydown', onInputKeydown);
    overlay.removeEventListener('keydown', onOverlayKeydown);
    document.removeEventListener('click', onDocumentClick);
    overlay.remove();
    anchor.classList.remove('search-suggestions-anchor');
    delete input.dataset.searchSuggestions;
  };

  return { destroy };
}

/**
 * Initialize header search: live results when a search widget is on the page,
 * otherwise typeahead suggestions.
 * @param {HTMLInputElement} input - Header search input
 * @param {Object} [opts]
 * @param {HTMLElement} [opts.anchor] - Element to align suggestions overlay with
 * @param {string} [opts.resultsPath] - Full search results page path
 */
export async function initHeaderSearch(input, opts = {}) {
  headerSearchInput = input;

  if (pageHasSearchWidget()) {
    tryWireSearchResults();
    return;
  }

  const { destroy } = await attachSearchSuggestions(input, opts);
  suggestionsDestroy = destroy;
}

/**
 * Decorates the search results widget.
 * @param {HTMLElement} widget - Widget container element
 */
export default async function decorate(widget) {
  const lang = (document.documentElement.lang || 'en').split('-')[0];
  const copy = await loadWidgetCopy(lang);

  hydrateCopy(widget, copy);
  searchResultsContainer = widget;
  window.hlx = window.hlx || {};
  window.hlx.searchWidgetOnPage = true;
  tryWireSearchResults();
}

export { loadSearchIndex, filterBySearch, searchItems };
