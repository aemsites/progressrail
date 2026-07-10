import { getLocale, loadCopy } from '../../scripts/scripts.js';

const DEFAULT_PAGE_SIZE = 12;

/**
 * Normalize a press release row from the query index.
 * @param {Object} row - Raw row from query-index.json
 * @returns {Object|null} Normalized item or null if not a press release
 */
function normalizeRelease(row) {
  const path = row.path || row.url || '';
  if (!path.includes('/press-releases/')) return null;
  const date = (row.date || '').trim();
  return {
    path,
    title: (row.title || '').trim(),
    date,
    timestamp: date ? Date.parse(date) : 0,
  };
}

/**
 * Fetch and cache press releases from the locale-specific query index.
 * @param {string} [locale] - Locale code (defaults to current page locale)
 * @returns {Promise<Array<Object>>} Releases sorted by date descending
 */
async function loadPressReleases(locale = getLocale()) {
  window.pressReleasesByLocale = window.pressReleasesByLocale || {};
  if (window.pressReleasesByLocale[locale]) {
    return window.pressReleasesByLocale[locale];
  }

  window.pressReleasesPromises = window.pressReleasesPromises || {};
  if (!window.pressReleasesPromises[locale]) {
    window.pressReleasesPromises[locale] = (async () => {
      const base = window.hlx?.codeBasePath || '';
      try {
        const resp = await fetch(`${base}/${locale}/query-index.json`);
        if (!resp.ok) {
          window.pressReleasesByLocale[locale] = [];
          return [];
        }
        const json = await resp.json();
        const rows = Array.isArray(json.data) ? json.data : [];
        const releases = rows
          .map(normalizeRelease)
          .filter(Boolean)
          .sort((a, b) => b.timestamp - a.timestamp);
        window.pressReleasesByLocale[locale] = releases;
        return releases;
      } catch (_) {
        window.pressReleasesByLocale[locale] = [];
        return [];
      }
    })();
  }

  return window.pressReleasesPromises[locale];
}

/**
 * Format an ISO date string for display in the current locale.
 * @param {string} dateStr - ISO date (YYYY-MM-DD)
 * @param {string} locale - BCP 47 locale tag
 * @returns {string}
 */
function formatReleaseDate(dateStr, locale) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Hydrate all [data-copy] elements from widget copy.
 * @param {HTMLElement} container - .press-releases root element
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

/**
 * Create a press release preview card.
 * @param {Object} item - Normalized release
 * @param {Object} copy - Widget copy
 * @param {string} locale - BCP 47 locale tag
 * @returns {HTMLElement}
 */
function createReleaseCard(item, copy, locale) {
  const li = document.createElement('li');
  li.className = 'press-release-item';

  if (item.date) {
    const time = document.createElement('time');
    time.dateTime = item.date;
    time.textContent = formatReleaseDate(item.date, locale);
    li.appendChild(time);
  }

  if (item.title) {
    const heading = document.createElement('h3');
    const titleLink = document.createElement('a');
    titleLink.href = item.path;
    titleLink.textContent = item.title;
    heading.appendChild(titleLink);
    li.appendChild(heading);
  }

  const cta = document.createElement('a');
  cta.className = 'press-release-cta';
  cta.href = item.path;
  cta.textContent = copy.learnMore || 'Learn More >';
  li.appendChild(cta);

  return li;
}

/**
 * Append release cards to the list element.
 * @param {HTMLElement} element - .releases list element
 * @param {Array<Object>} releases - Full release set
 * @param {number} start - Start index (inclusive)
 * @param {number} end - End index (exclusive)
 * @param {Object} copy - Widget copy
 * @param {string} locale - BCP 47 locale tag
 */
function appendReleases(element, releases, start, end, copy, locale) {
  releases.slice(start, end)
    .forEach((item) => element.append(createReleaseCard(item, copy, locale)));
}

/**
 * Wire load-more behavior to the widget container.
 * @param {HTMLElement} container - .press-releases root
 * @param {Object} copy - Widget copy
 * @param {number} pageSize - Items per batch
 */
function buildPressReleasesListing(container, copy, pageSize) {
  let visibleCount = pageSize;
  const releasesElement = container.querySelector('.press-release-list');
  const loadMoreWrapper = container.querySelector('.press-release-load-more');
  const loadMoreButton = loadMoreWrapper?.querySelector('button');
  const noResultsElement = container.querySelector('.press-release-empty');
  const locale = getLocale();

  const updateLoadMore = (total) => {
    if (!loadMoreWrapper) return;
    loadMoreWrapper.hidden = visibleCount >= total;
  };

  const render = async () => {
    const releases = await loadPressReleases();

    const hasResults = releases.length > 0;
    if (noResultsElement) noResultsElement.hidden = hasResults;
    releasesElement.hidden = !hasResults;

    if (!hasResults) {
      releasesElement.innerHTML = '';
      if (loadMoreWrapper) loadMoreWrapper.hidden = true;
      return;
    }

    releasesElement.innerHTML = '';
    appendReleases(releasesElement, releases, 0, visibleCount, copy, locale);
    updateLoadMore(releases.length);
  };

  if (loadMoreButton) {
    loadMoreButton.addEventListener('click', async () => {
      const releases = await loadPressReleases();
      const prevCount = visibleCount;
      visibleCount = Math.min(visibleCount + pageSize, releases.length);
      appendReleases(
        releasesElement,
        releases,
        prevCount,
        visibleCount,
        copy,
        locale,
      );
      updateLoadMore(releases.length);
    });
  }

  render();
}

/**
 * Decorates the press releases widget.
 * @param {HTMLElement} widget - Widget container element
 */
export default async function decorate(widget) {
  if (widget.dataset.pressReleasesInitialized === 'true') return;
  widget.dataset.pressReleasesInitialized = 'true';

  const copy = await loadCopy(import.meta.url);

  hydrateCopy(widget, copy);

  const pageSize = parseInt(widget.dataset.pageSize, 10) || DEFAULT_PAGE_SIZE;
  buildPressReleasesListing(widget, copy, pageSize);
}
