import {
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  buildBlock,
  getMetadata,
  createOptimizedPicture,
} from './aem.js';

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Whether the element is the page's primary main, not a detached fragment container.
 * @param {Element} main The container element
 * @returns {boolean}
 */
function isPageMain(main) {
  return main === document.querySelector('main');
}

/**
 * Whether a URL points at the press-releases widget.
 * @param {string} href - Link href
 * @returns {boolean}
 */
function isPressReleasesWidgetHref(href) {
  try {
    const { pathname } = new URL(href, window.location.href);
    return /\/widgets\/press-releases\/press-releases(\.html)?$/i.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Whether the page already includes a press-releases widget.
 * @param {Element} main The container element
 * @returns {boolean}
 */
function hasPressReleasesWidget(main) {
  if (main.querySelector('.press-releases')) return true;
  return [...main.querySelectorAll('a[href]')].some((a) => isPressReleasesWidgetHref(a.href));
}

/**
 * Appends a press-releases widget link on press-release template pages.
 * @param {Element} main The container element
 */
function appendPressReleaseWidgetLink(main) {
  if (getMetadata('template') !== 'press-release') return;
  if (hasPressReleasesWidget(main)) return;

  const link = document.createElement('a');
  link.href = `${window.hlx.codeBasePath}/widgets/press-releases/press-releases.html?pageSize=3`;
  link.textContent = link.href;

  const section = document.createElement('div');
  const p = document.createElement('p');
  p.append(link);
  section.append(p);
  main.append(section);
}

/**
 * Builds template-specific auto blocks (page main only).
 * @param {Element} main The container element
 */
function buildTemplateAutoBlocks(main) {
  if (!isPageMain(main)) return;
  appendPressReleaseWidgetLink(main);
}

/**
 * Turns `/widgets/...` links into widget blocks.
 * @param {Element} main The container element
 */
function buildWidgetAutoBlocks(main) {
  const widgetLinks = [...main.querySelectorAll('a[href*="/widgets/"]')];
  widgetLinks.forEach((link) => {
    if (link.closest('.widget')) return;
    const newLink = link.cloneNode(true);
    const widgetBlock = buildBlock('widget', { elems: [newLink] });
    const p = link.closest('p');
    if (
      p
      && p.querySelectorAll('a').length === 1
      && p.querySelector('a') === link
      && p.textContent.trim() === link.textContent.trim()
    ) {
      p.replaceWith(widgetBlock);
    } else {
      link.replaceWith(widgetBlock);
    }
  });
}

/**
 * Returns the two-letter language code for the current page.
 * @returns {string}
 */
export function getLocale() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  const lang = (segment && /^[a-z]{2}(-[a-z]{2})?$/i.test(segment)) ? segment : 'en';
  return lang.split('-')[0].toLowerCase();
}

/**
 * Fetches localized UI strings from a folders's companion JSON file.
 * @param {string} scriptUrl - The module's `import.meta.url`
 * @returns {Promise<Object>}
 */
export async function loadCopy(scriptUrl) {
  const jsonPath = new URL(scriptUrl).pathname.replace(/\.js$/, '.json');
  const url = `${(window.hlx && window.hlx.codeBasePath) || ''}${jsonPath}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return {};
    const data = await resp.json();
    return data[getLocale()] || data.en || {};
  } catch {
    return {};
  }
}

/**
 * Whether a URL points at a YouTube video page.
 * @param {string} href - Link href
 * @returns {boolean}
 */
export function isYouTubeHref(href) {
  try {
    const { hostname } = new URL(href);
    return hostname === 'youtu.be' || hostname.endsWith('youtube.com');
  } catch {
    return false;
  }
}

/**
 * Builds a YouTube iframe.
 * @param {string} url - the video page or short URL to parse
 * @param {Object} copy - Localized UI strings
 * @returns {HTMLIFrameElement|null} configured embed iframe
 */
export function createYouTubeEmbed(url, copy = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  const id = hostname === 'youtu.be' ? pathname.slice(1) : searchParams.get('v');
  if (!id) return null;

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${id}`;
  iframe.title = copy.youTubeVideo || 'YouTube video';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  return iframe;
}

/**
 * Builds a thumbnail overlay with a play button.
 * @param {HTMLElement|null} picture - thumbnail image element to display; returns null if absent
 * @param {Function} onPlay - called when the user activates the play control
 * @returns {HTMLElement|null} the placeholder figure
 */
export function createPlaceholder(picture, onPlay) {
  if (!picture) return null;

  const figure = document.createElement('figure');
  figure.classList.add('placeholder');
  figure.setAttribute('role', 'button');
  figure.setAttribute('tabindex', '0');
  figure.append(picture);

  const icon = document.createElement('span');
  icon.className = 'icon icon-play';
  figure.append(icon);
  decorateIcons(figure);

  function play() {
    onPlay();
    figure.remove();
  }

  figure.addEventListener('click', play);
  figure.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      play();
    }
  });

  return figure;
}

/**
 * Whether el is a paragraph containing a single YouTube link.
 * @param {Element} el - Element to test
 * @returns {boolean}
 */
export function isVideoLink(el) {
  if (el.tagName !== 'P' || el.children.length !== 1) return false;
  const a = el.firstElementChild;
  return a.tagName === 'A' && isYouTubeHref(a.href);
}

/**
 * Transforms a media container with a YouTube link into a video embed.
 * @param {HTMLElement} container - Container whose children are replaced with the embed
 * @param {string} href - YouTube URL to embed
 */
export function decorateVideo(container, href) {
  const embed = createYouTubeEmbed(href);
  if (!embed) return;

  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-embed';

  const picture = container.querySelector('picture');
  const placeholder = createPlaceholder(picture, () => {
    const src = new URL(embed.src);
    src.searchParams.set('autoplay', 1);
    embed.src = src.href;
    if (!embed.isConnected) videoContainer.append(embed);
  });

  if (placeholder) videoContainer.append(placeholder);
  container.replaceChildren(videoContainer);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      videoContainer.append(embed);
      observer.disconnect();
    });
  }, { rootMargin: '0px' });
  observer.observe(videoContainer);
}

/**
 * Finds a video link in a media container and converts it into a video embed.
 * @param {HTMLElement} container - Container to inspect and potentially transform
 */
export function transformVideoLinks(container) {
  const videoLinkEl = [...container.children].find(isVideoLink);
  if (videoLinkEl) {
    const nonVideo = [...container.children].filter((el) => el !== videoLinkEl);
    const isPictureParagraph = (el) => el.tagName === 'P'
      && el.children.length === 1
      && el.firstElementChild.tagName === 'PICTURE';
    if (nonVideo.every((el) => el.tagName === 'PICTURE' || el.tagName === 'VIDEO' || isPictureParagraph(el))) {
      decorateVideo(container, videoLinkEl.firstElementChild.href);
    }
  }
}

/**
 * Turns standalone YouTube links into video blocks.
 * @param {Element} main The container element
 */
export function buildVideoAutoBlocks(main) {
  [...main.querySelectorAll('a[href]')]
    .filter((a) => isYouTubeHref(a.href) && !a.closest('main > div > div[class]'))
    .forEach((link) => {
      const newLink = link.cloneNode(true);
      const videoBlock = buildBlock('video', { elems: [newLink] });
      const p = link.closest('p');
      if (
        p
        && p.querySelectorAll('a[href').length === 1
        && p.querySelector('a[href') === link
        && p.textContent.trim() === link.textContent.trim()
      ) {
        p.replaceWith(videoBlock);
      } else {
        link.replaceWith(videoBlock);
      }
    });
}

/**
 * Inlines /fragments/ links by fetching and replacing them with their content.
 * @param {Element} main The container element
 */
function buildFragmentAutoBlocks(main) {
  [...main.querySelectorAll('a[href*="/fragments/"]')]
    .filter((f) => !f.closest('.fragment'))
    .forEach((link) => {
      const fragmentBlock = buildBlock('fragment', { elems: [link.cloneNode(true)] });
      const p = link.closest('p');
      (p || link).replaceWith(fragmentBlock);
    });
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    buildTemplateAutoBlocks(main);
    buildWidgetAutoBlocks(main);
    buildVideoAutoBlocks(main);
    buildFragmentAutoBlocks(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates formatted links to style them as buttons.
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();

    // quick structural checks
    if (a.querySelector('img') || p.textContent.trim() !== text) return;

    // skip URL display links
    try {
      if (new URL(a.href).href === new URL(text, window.location).href) return;
    } catch { /* continue */ }

    // require authored formatting for buttonization
    const strong = a.closest('strong');
    const em = a.closest('em');
    if (!strong && !em) return;

    p.className = 'button-wrapper';
    a.className = 'button';
    if (strong && em) { // high-impact call-to-action
      a.classList.add('secondary');
      const outer = strong.contains(em) ? strong : em;
      outer.replaceWith(a);
    } else if (strong) {
      a.classList.add('cta');
      strong.replaceWith(a);
    } else {
      a.classList.add('primary');
      em.replaceWith(a);
    }
  });

  // collapse adjacent button wrappers
  let adjacent = main.querySelector('p.button-wrapper + p.button-wrapper');
  while (adjacent) {
    const prev = adjacent.previousElementSibling;
    adjacent.querySelectorAll('a.button').forEach((btn) => prev.appendChild(btn));
    adjacent.remove();
    adjacent = main.querySelector('p.button-wrapper + p.button-wrapper');
  }
}

/**
 * Replaces standalone .mp4 links with native video elements.
 * @param {Element} main The container element
 */
function decorateVideos(main) {
  main.querySelectorAll('a[href$=".mp4"]').forEach((link) => {
    const video = document.createElement('video');
    video.src = link.href;
    video.controls = true;
    video.setAttribute('playsinline', '');
    const p = link.closest('p');
    if (
      p
      && p.querySelectorAll('a[href]').length === 1
      && p.querySelector('a[href]') === link
      && p.textContent.trim() === link.textContent.trim()
    ) {
      p.replaceWith(video);
    } else {
      link.replaceWith(video);
    }
  });
}

/**
 * Rewrites a query-index image URL to use the current page origin.
 * @param {string} src - Image URL from query-index.json
 * @returns {string}
 */
export function normalizeIndexImageUrl(src) {
  if (!src) return '';
  try {
    const { pathname, search } = new URL(src, window.location.href);
    return `${window.location.origin}${pathname}${search}`;
  } catch {
    return src;
  }
}

/**
 * Fetches the locale-specific query index.
 * @param {string} lang - Language key (e.g. en)
 * @returns {Promise<Array<Object>>}
 */
export async function loadIndex(lang) {
  const base = (window.hlx && window.hlx.codeBasePath) || '';
  const resp = await fetch(`${base}/${lang}/query-index.json`);
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Whether a query-index item path is exactly one segment below a parent path.
 * @param {string} itemPath - Path from query-index.json
 * @param {string} parentPath - Path to check against
 * @returns {boolean}
 */
export function isDirectChild(itemPath, parentPath) {
  const normalized = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
  if (!itemPath.startsWith(`${normalized}/`)) return false;
  const rest = itemPath.slice(normalized.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

/**
 * Builds a cards-block-compatible row (media + body cells) from a query-index item.
 * @param {Object} item - Normalized query-index item
 * @param {boolean} [showDescription=true] - Whether to include the description paragraph
 * @returns {HTMLElement}
 */
export function buildCardRow(item, showDescription = true) {
  const row = document.createElement('div');

  const image = normalizeIndexImageUrl(item.image);
  if (image) {
    const mediaCell = document.createElement('div');
    const picture = createOptimizedPicture(image, item.title || '', false, [{ width: '750' }]);
    mediaCell.append(picture);
    row.append(mediaCell);
  }

  const bodyCell = document.createElement('div');
  if (item.title) {
    const heading = document.createElement('h3');
    const link = document.createElement('a');
    link.href = item.path;
    link.textContent = item.title;
    heading.append(link);
    bodyCell.append(heading);
  }
  if (showDescription && item.description) {
    const p = document.createElement('p');
    p.textContent = item.description;
    bodyCell.append(p);
  }
  row.append(bodyCell);

  return row;
}

/**
 * Hydrates all `[data-copy]` elements within a container from a widget copy object.
 * @param {HTMLElement} container - Root element to search within
 * @param {Object} copy - Widget copy for the current language
 */
export function hydrateCopy(container, copy) {
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
 * Sets target and rel on links whose hostname differs from the current page.
 * @param {Element} container - The element to search for links within
 */
export function decorateExternalLinks(container) {
  container.querySelectorAll('a[href]').forEach((link) => {
    if (new URL(link.href).hostname !== window.location.hostname) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateIcons(main);
  decorateButtons(main);
  decorateVideos(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = getLocale();
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  loadHeader(doc.querySelector('body > header'));

  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('body > footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed(doc) {
  import('./consent-check.js');
  // load anything that can be postponed to the latest here
  decorateExternalLinks(doc.querySelector('main'));
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed(document);
}

loadPage();
