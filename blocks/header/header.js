import { getMetadata, decorateIcons } from '../../scripts/aem.js';
import { decorateExternalLinks, loadCopy, getLocale } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Returns a named header section from within the block.
 * @param {Element} block - The header block element
 * @param {string} sectionName - The section name, matching the header-{name} class
 * @returns {Element|null} The section element, or `null` if not found
 */
function getSection(block, sectionName) {
  return block.querySelector(`.header-${sectionName}`);
}

/**
 * Wraps the logo image in its anchor if an href is present.
 * @param {Element} section - The logo section element
 */
function decorateLogo(section) {
  const img = section.querySelector('img, svg');
  if (!img) return;
  const link = section.querySelector('a[href]');
  if (link) {
    const picture = img.closest('picture') || img;
    link.textContent = '';
    link.append(picture);
    section.textContent = '';
    section.append(link);
  }
}

/**
 * Replaces the section div with a semantic nav element and decorates all nav items.
 * @param {Element} section - The nav section element to promote
 */
function decorateNav(section) {
  const list = section.querySelector('ul');
  if (!list) return;

  list.querySelectorAll(':scope > li').forEach((item) => {
    const p = item.querySelector(':scope > p');
    const submenu = item.querySelector(':scope > ul');
    if (!p) return;

    const label = p.textContent.trim();

    if (submenu) {
      // top-level trigger button
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-expanded', false);
      button.setAttribute('aria-haspopup', true);
      button.textContent = label;
      const chevron = document.createElement('span');
      chevron.classList.add('icon', 'icon-chevron', 'chevron-right');
      button.append(chevron);
      p.replaceWith(button);

      // back button injected as first child of every submenu
      const backLi = document.createElement('li');
      backLi.classList.add('submenu-back');
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      const backArrow = document.createElement('span');
      backArrow.classList.add('icon', 'icon-arrow', 'arrow-left');
      const backLabel = document.createElement('span');
      backLabel.textContent = label;
      backBtn.append(backArrow, backLabel);
      backLi.append(backBtn);
      submenu.prepend(backLi);

      // detect multi-nav: any submenu li that has both a <p> and a <ul>
      const isMulti = [...submenu.querySelectorAll(':scope > li')].some(
        (li) => li.querySelector(':scope > p') && li.querySelector(':scope > ul'),
      );

      if (isMulti) {
        submenu.classList.add('submenu-multi');

        submenu.querySelectorAll(':scope > li:not(.submenu-back)').forEach((catItem, i) => {
          const catP = catItem.querySelector(':scope > p');
          if (!catP) return;

          const catBtn = document.createElement('button');
          catBtn.type = 'button';
          // first category open by default on desktop only
          catBtn.setAttribute('aria-expanded', i === 0 && window.matchMedia('(min-width: 1200px)').matches);
          catBtn.textContent = catP.textContent.trim();
          const catChevron = document.createElement('span');
          catChevron.classList.add('icon', 'icon-chevron');
          catBtn.append(catChevron);

          catBtn.addEventListener('click', () => {
            const expanded = catBtn.getAttribute('aria-expanded') === 'true';
            // desktop: never close the active category, only switch
            if (expanded && window.matchMedia('(min-width: 1200px)').matches) return;
            // mutual exclusion within this submenu-multi
            submenu.querySelectorAll(':scope > li > button[aria-expanded="true"]').forEach((open) => {
              open.setAttribute('aria-expanded', false);
            });
            // mobile: toggle; desktop always opens
            if (!expanded) catBtn.setAttribute('aria-expanded', true);
          });

          catP.replaceWith(catBtn);
        });
      }

      // top-level button click: toggle this item, close siblings, manage push-panel state
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        const nav = button.closest('nav');

        // close any other open top-level buttons and clear their state
        list.querySelectorAll(':scope > li > button[aria-expanded="true"]').forEach((open) => {
          if (open !== button) {
            open.setAttribute('aria-expanded', false);
            open.closest('li').removeAttribute('data-active');
          }
        });

        if (!expanded) {
          button.setAttribute('aria-expanded', true);
          item.dataset.active = '';
          nav.dataset.submenu = 'expanded';
          if (!window.matchMedia('(min-width: 1200px)').matches) backBtn.focus();
        } else {
          button.setAttribute('aria-expanded', false);
          item.removeAttribute('data-active');
          nav.removeAttribute('data-submenu');
        }
      });

      // back button click: return to top-level list
      backBtn.addEventListener('click', () => {
        button.setAttribute('aria-expanded', false);
        item.removeAttribute('data-active');
        const nav = backBtn.closest('nav');
        nav.removeAttribute('data-submenu');
        button.focus();
      });
    } else {
      const link = p.querySelector('a');
      if (link) p.replaceWith(link);
    }
  });

  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.classList.add(...section.classList);
  nav.append(list);
  section.replaceWith(nav);

  // close all on click outside
  document.addEventListener('click', (e) => {
    if (nav.contains(e.target)) return;
    nav.querySelectorAll(':scope > ul > li > button[aria-expanded="true"]').forEach((open) => {
      open.setAttribute('aria-expanded', false);
    });
    nav.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
    nav.removeAttribute('data-submenu');
  });

  // close all on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = nav.querySelector(':scope > ul > li > button[aria-expanded="true"]');
    if (!open) return;
    nav.querySelectorAll(':scope > ul > li > button[aria-expanded="true"]').forEach((btn) => {
      btn.setAttribute('aria-expanded', false);
    });
    nav.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
    nav.removeAttribute('data-submenu');
    open.focus();
  });
}

/**
 * Whether the page includes a search results widget.
 * @returns {boolean}
 */
function pageHasSearchWidget() {
  return !!window.hlx?.searchWidgetOnPage
    || !!document.querySelector('.widget.search, .search.widget, .widget a[href*="/widgets/search/"]');
}

/**
 * Builds a search form with an input and submit button inside the section.
 * @param {Element} section - The search section element
 * @param {Object} copy - Localized UI strings
 */
function decorateSearch(section, copy) {
  const p = section.querySelector('p');
  const placeholder = p ? p.textContent.trim() : (copy.search || 'Search');

  const form = document.createElement('form');
  form.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'header-search';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.setAttribute('autocomplete', 'off');

  const submitBtn = document.createElement('button');
  submitBtn.classList.add('button', 'cta');
  submitBtn.type = 'submit';
  submitBtn.setAttribute('aria-label', placeholder);
  const searchIcon = document.createElement('span');
  searchIcon.classList.add('icon', 'icon-search');
  submitBtn.append(searchIcon);

  form.append(input, submitBtn);
  section.textContent = '';
  section.append(form);

  const locale = getLocale();
  const searchResultsPath = `/${locale}/search`;

  const params = new URLSearchParams(window.location.search);
  if (params.get('search')) {
    input.value = params.get('search');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    if (pageHasSearchWidget()) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    window.location.href = `${searchResultsPath}?search=${encodeURIComponent(query)}`;
  });

  document.dispatchEvent(new CustomEvent('header-search-ready', { detail: { input } }));
  window.hlx = window.hlx || {};
  window.hlx.headerSearch = input;

  const searchModulePath = `${window.hlx?.codeBasePath || ''}/widgets/search/search.js`;
  import(searchModulePath).then((mod) => {
    mod.initHeaderSearch(input, {
      anchor: section,
      resultsPath: searchResultsPath,
    });
  });
}

/**
 * Decorates the language selector and marks the current locale.
 * @param {Element} section - The language section element
 */
function decorateLanguage(section) {
  // referenced by hamburger's aria-controls
  section.id = 'header-language';

  const currentItem = section.querySelector('strong');
  if (!currentItem) return;

  const link = currentItem.querySelector('a[href]');
  if (!link) return;

  link.setAttribute('aria-current', true);

  const globe = document.createElement('span');
  globe.classList.add('icon', 'icon-globe');
  link.prepend(globe);

  // unwrap <strong>, keeping only the <a> with icon
  currentItem.replaceWith(link);
}

/**
 * Builds the hamburger button that controls the mobile nav and language overlay.
 * @param {Object} copy - Localized UI strings
 * @returns {Element} - The hamburger section element
 */
function buildHamburger(copy) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('section', 'header-hamburger');

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-expanded', false);
  button.setAttribute('aria-controls', 'nav header-language');
  button.setAttribute('aria-label', copy.menu || 'Menu');

  const icon = document.createElement('span');
  icon.classList.add('icon-hamburger');
  button.append(icon);

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', !expanded);

    const headerEl = button.closest('.header');
    const nav = headerEl.querySelector('#nav');
    const main = nav.closest('main');
    if (!nav) return;
    if (!expanded) { // opening
      nav.dataset.expanded = '';
      headerEl.dataset.nav = 'expanded';
      document.body.dataset.scroll = 'disabled';
      main.setAttribute('inert', '');
    } else { // closing; reset all sub-state too
      delete nav.dataset.expanded;
      nav.removeAttribute('data-submenu');
      nav.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
      nav.querySelectorAll('button[aria-expanded="true"]').forEach((btn) => {
        btn.setAttribute('aria-expanded', false);
      });
      delete headerEl.dataset.nav;
      delete document.body.dataset.scroll;
      main.removeAttribute('inert');
    }
  });

  // sync nav state when viewport crosses the desktop breakpoint
  window.matchMedia('(min-width: 1200px)').addEventListener('change', (e) => {
    const headerEl = button.closest('.header');
    const nav = headerEl.querySelector('#nav');
    const main = nav.closest('main');

    if (e.matches) {
      // crossed into desktop: clean up mobile state, then open first category in each submenu-multi
      button.setAttribute('aria-expanded', false);
      if (nav) {
        delete nav.dataset.expanded;
        nav.removeAttribute('data-submenu');
        nav.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
        nav.querySelectorAll('button[aria-expanded="true"]').forEach((btn) => {
          btn.setAttribute('aria-expanded', false);
        });
        nav.querySelectorAll('.submenu-multi').forEach((multi) => {
          const firstBtn = multi.querySelector(':scope > li:not(.submenu-back) > button');
          if (firstBtn) firstBtn.setAttribute('aria-expanded', true);
        });
      }
      delete headerEl.dataset.nav;
      delete document.body.dataset.scroll;
      main.removeAttribute('inert');
    } else if (nav) {
      // crossed into mobile: collapse all submenu-multi categories
      nav.querySelectorAll('.submenu-multi > li > button[aria-expanded="true"]').forEach((btn) => {
        btn.setAttribute('aria-expanded', false);
      });
    }
  });

  wrapper.append(button);
  return wrapper;
}

/**
 * Loads and decorates the header, including the nav.
 * @param {Element} block - The header block element
 */
export default async function decorate(block) {
  const copy = await loadCopy(import.meta.url);
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);

  block.textContent = '';
  block.append(...fragment.children);

  const sections = ['logo', 'nav', 'language', 'search'];
  sections.forEach((s, i) => {
    const section = block.children[i];
    if (section) section.classList.add(`header-${s}`);
  });

  const logo = getSection(block, 'logo');
  if (logo) decorateLogo(logo);

  const nav = getSection(block, 'nav');
  if (nav) decorateNav(nav);

  const language = getSection(block, 'language');
  if (language) decorateLanguage(language);

  const search = getSection(block, 'search');
  if (search) decorateSearch(search, copy);

  const hamburger = buildHamburger(copy);
  block.prepend(hamburger);

  decorateExternalLinks(block);
  decorateIcons(block);
}
