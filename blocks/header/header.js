import { getMetadata, decorateIcons } from '../../scripts/aem.js';
import { decorateExternalLinks } from '../../scripts/scripts.js';
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
 * Replaces the section div with a semantic nav element and decorates top-level items.
 * @param {Element} section - The nav section element to promote
 */
function decorateNav(section) {
  const list = section.querySelector('ul');
  if (!list) return;

  list.querySelectorAll(':scope > li').forEach((item) => {
    const p = item.querySelector(':scope > p');
    const submenu = item.querySelector(':scope > ul');
    if (!p) return;

    if (submenu) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-expanded', false);
      button.textContent = p.textContent.trim();
      const chevron = document.createElement('span');
      chevron.classList.add('icon', 'icon-chevron');
      button.append(chevron);
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.closest('ul').querySelectorAll('button[aria-expanded="true"]').forEach((open) => {
          open.setAttribute('aria-expanded', false);
        });
        if (!expanded) button.setAttribute('aria-expanded', true);
      });
      p.replaceWith(button);
    } else {
      const link = p.querySelector('a');
      if (link) p.replaceWith(link);
    }
  });

  const nav = document.createElement('nav');
  nav.classList.add(...section.classList);
  nav.append(list);
  section.replaceWith(nav);

  document.addEventListener('click', (e) => {
    if (nav.contains(e.target)) return;
    nav.querySelectorAll('button[aria-expanded="true"]').forEach((open) => {
      open.setAttribute('aria-expanded', false);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = nav.querySelector('button[aria-expanded="true"]');
    if (!open) return;
    open.setAttribute('aria-expanded', false);
    open.focus();
  });
}

/**
 * Builds the hamburger section.
 * @returns {Element} - The hamburger section element
 */
function buildHamburger() {
  const wrapper = document.createElement('div');
  wrapper.classList.add('section', 'header-hamburger');

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-expanded', false);
  button.setAttribute('aria-controls', 'nav');
  button.setAttribute('aria-label', 'Menu'); // TODO: localization

  const icon = document.createElement('span');
  icon.classList.add('icon-hamburger');
  button.append(icon);

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', !expanded);
  });

  wrapper.append(button);
  return wrapper;
}

/**
 * Loads and decorates the header, including the nav.
 * @param {Element} block - The header block element
 */
export default async function decorate(block) {
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

  const hamburger = buildHamburger();
  block.prepend(hamburger);

  decorateExternalLinks(block);
  decorateIcons(block);
}
