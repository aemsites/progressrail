import { getMetadata, decorateIcons } from '../../scripts/aem.js';
import { decorateExternalLinks } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Returns a named footer section from within the block.
 * @param {Element} block - The footer block element
 * @param {string} sectionName - The section name, matching the footer-{name} class
 * @returns {Element|null} The section element, or `null` if not found
 */
function getSection(block, sectionName) {
  return block.querySelector(`.footer-${sectionName}`);
}

/**
 * Wraps each direct h2+ul pair within a container in a details/summary.
 * @param {Element} container - The element whose direct h2+ul children to transform
 */
function decorateDetails(container) {
  const mq = window.matchMedia('(width >= 600px)');
  const created = [];

  container.querySelectorAll(':scope > h2').forEach((heading) => {
    const list = heading.nextElementSibling;
    if (!list || list.tagName !== 'UL') return;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = heading.textContent;
    const chevron = document.createElement('span');
    chevron.classList.add('icon', 'icon-chevron');
    summary.append(chevron);
    details.append(summary, list);
    heading.replaceWith(details);
    created.push({ details, list, summary });

    summary.addEventListener('click', (e) => {
      e.preventDefault();
      if (mq.matches) return;
      if (details.open) {
        list.style.height = `${list.scrollHeight}px`;
        list.getBoundingClientRect();
        list.style.height = '0';
        list.addEventListener('transitionend', () => {
          details.removeAttribute('open');
        }, { once: true });
      } else {
        details.setAttribute('open', '');
        const targetHeight = list.scrollHeight;
        list.style.height = '0';
        list.getBoundingClientRect();
        list.style.height = `${targetHeight}px`;
      }
    });
  });

  const handleBreakpoint = ({ matches }) => {
    created.forEach(({ details, list, summary }) => {
      if (matches) {
        details.setAttribute('open', '');
        summary.setAttribute('tabindex', '-1');
      } else {
        details.removeAttribute('open');
        summary.removeAttribute('tabindex');
      }
      list.style.height = '';
    });
  };

  mq.addEventListener('change', handleBreakpoint);
  handleBreakpoint(mq);
}

/**
 * Replaces the section div with a nav landmark.
 * @param {Element} section - The footer-nav section element to promote
 */
function decorateNav(section) {
  const content = section.querySelector('div');
  if (!content) return;
  decorateDetails(content);
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Footer'); // TODO: localization
  nav.classList.add(...section.classList);
  nav.append(...content.children);
  section.replaceWith(nav);
}

/**
 * Converts the "Cookie Settings" bare text item into a button for OneTrust SDK hookup.
 * @param {Element} section - The footer-copyright section element
 */
function decorateCopyright(section) {
  section.querySelectorAll('li').forEach((li) => {
    if (li.querySelector('a[href]')) return;
    const text = li.textContent.trim();
    if (!text) return;
    const btn = document.createElement('button');
    btn.id = 'cookie';
    btn.type = 'button';
    btn.textContent = text;
    // TODO: wire up OneTrust consent SDK
    li.replaceChildren(btn);
  });
}

/**
 * Adds accessible labels to icon-only social links, derived from each link's URL.
 * @param {Element} section - The social section element
 */
function decorateSocial(section) {
  section.querySelectorAll('a[href]').forEach((link) => {
    const { hostname } = new URL(link.href);
    const host = hostname.replace(/^www\./, '');
    const name = host.split('.')[0];
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    link.setAttribute('aria-label', label);
  });
}

/**
 * Loads and decorates the footer.
 * @param {Element} block - The footer block element
 */
export default async function decorate(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const fragment = await loadFragment(footerPath);

  block.textContent = '';
  block.append(...fragment.children);

  const sections = ['nav', 'social', 'copyright'];
  sections.forEach((s, i) => {
    const section = block.children[i];
    if (section) section.classList.add(`footer-${s}`);
  });

  const nav = getSection(block, 'nav');
  if (nav) decorateNav(nav);

  const social = getSection(block, 'social');
  if (social) decorateSocial(social);

  const copyright = getSection(block, 'copyright');
  if (copyright) decorateCopyright(copyright);

  decorateExternalLinks(block);
  decorateIcons(block);
}
