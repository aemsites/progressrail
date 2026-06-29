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
 * Whether a URL points at a YouTube video page.
 * @param {string} href - Link href
 * @returns {boolean}
 */
function isYouTubeHref(href) {
  try {
    const { hostname } = new URL(href);
    return hostname === 'youtu.be' || hostname.endsWith('youtube.com');
  } catch {
    return false;
  }
}

/**
 * Turns standalone YouTube links into video blocks.
 * @param {Element} main The container element
 */
export function buildVideoAutoBlocks(main) {
  [...main.querySelectorAll('a[href]')]
    .filter((a) => isYouTubeHref(a.href) && !a.closest('.video'))
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
  document.documentElement.lang = 'en';
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
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
  decorateExternalLinks(doc.querySelector('main'));
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed(document);
}

loadPage();
