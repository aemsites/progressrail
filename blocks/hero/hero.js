import { decorateIcons } from '../../scripts/aem.js';
import { loadCopy } from '../../scripts/scripts.js';

/**
 * Configures ambient video and unwraps pictures.
 * @param {HTMLElement} col - Column element containing media
 */
function decorateMedia(col) {
  const video = col.querySelector('video');
  if (video) {
    video.removeAttribute('controls');
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
  }

  col.querySelectorAll('p > picture').forEach((pic) => {
    pic.parentElement.replaceWith(pic);
  });
}

/**
 * Returns `true` if a column contains only media elements.
 * @param {HTMLElement} col - Column element
 * @returns {boolean}
 */
function isMediaColumn(col) {
  const els = [...col.children];
  return els.length > 0 && els.every((el) => {
    if (el.tagName === 'VIDEO' || el.tagName === 'PICTURE') return true;
    return el.tagName === 'P' && el.children.length === 1 && el.children[0].tagName === 'PICTURE';
  });
}

/**
 * Classifies and decorates the media and body columns within a slide row.
 * @param {HTMLElement} row - Row div containing two columns
 */
function decorateSlide(row) {
  const cols = [...row.querySelectorAll(':scope > div')];
  const mediaCol = cols.find(isMediaColumn);
  const bodyCol = cols.find((col) => col !== mediaCol);
  if (mediaCol) {
    mediaCol.className = 'media-wrapper';
    decorateMedia(mediaCol);
  }
  if (bodyCol) bodyCol.className = 'body-wrapper';
  if (mediaCol && cols[0] === mediaCol) row.dataset.body = 'right';
}

/**
 * Shows or hides prev/next buttons based on the active slide index.
 * @param {HTMLElement} block - Hero block element
 * @param {number} i - Active slide index
 */
function updateNav(block, i) {
  const total = block.querySelectorAll('.slide').length;
  block.querySelector('.prev').hidden = i <= 0;
  block.querySelector('.next').hidden = i >= total - 1;
}

/**
 * Updates carousel for new active slide.
 * @param {HTMLElement} block - Hero block element
 * @param {number} i - Index of the slide to mark active
 */
function setActive(block, i) {
  block.dataset.activeSlide = i;
  block.querySelectorAll('.slide').forEach((slide, j) => {
    slide.setAttribute('aria-hidden', j !== i);
    slide.querySelectorAll('a[href]').forEach((a) => {
      if (j !== i) a.setAttribute('tabindex', '-1');
      else a.removeAttribute('tabindex');
    });
  });
  block.querySelectorAll('.indicators button').forEach((btn, j) => {
    if (j === i) {
      btn.setAttribute('disabled', true);
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.removeAttribute('disabled');
      btn.removeAttribute('aria-current');
    }
  });
  updateNav(block, i);
}

/**
 * Scrolls to a target slide index and syncs all active state.
 * @param {HTMLElement} block - Hero block element
 * @param {number} i - Target slide index (clamped to valid range)
 */
function goTo(block, i) {
  const slides = block.querySelectorAll('.slide');
  const target = slides[Math.max(0, Math.min(i, slides.length - 1))];
  setActive(block, parseInt(target.dataset.slideIndex, 10));
  block.querySelector('.slides').scrollTo({
    top: 0, left: target.offsetLeft, behavior: 'smooth',
  });
}

/**
 * Creates a carousel nav button with a chevron icon.
 * @param {string} direction - Direction key (`prev` or `next`)
 * @param {string} label - Accessible label for the button
 * @param {boolean} hidden - Whether the button starts hidden
 * @returns {HTMLButtonElement}
 */
function makeNavButton(direction, label, hidden) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add(direction, 'button');
  btn.setAttribute('aria-label', label);
  if (hidden) btn.hidden = true;
  const icon = document.createElement('span');
  icon.classList.add('icon', 'icon-chevron', `chevron-${direction === 'prev' ? 'left' : 'right'}`);
  btn.append(icon);
  return btn;
}

/**
 * Attaches click handlers and an IntersectionObserver .
 * @param {HTMLElement} block - Hero block element
 */
function bindEvents(block) {
  block.querySelectorAll('.indicators button').forEach((btn) => {
    btn.addEventListener('click', () => goTo(block, parseInt(btn.dataset.targetSlide, 10)));
  });
  const prev = block.querySelector('.prev');
  const next = block.querySelector('.next');
  prev.addEventListener('click', () => goTo(block, parseInt(block.dataset.activeSlide, 10) - 1));
  next.addEventListener('click', () => goTo(block, parseInt(block.dataset.activeSlide, 10) + 1));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) setActive(block, parseInt(entry.target.dataset.slideIndex, 10));
    });
  }, { threshold: 0.5 });
  block.querySelectorAll('.slide').forEach((slide) => observer.observe(slide));
}

/**
 * Builds carousel DOM and binds behavior.
 * @param {HTMLElement} block - Hero block element
 * @param {HTMLElement[]} rows - Direct row divs
 * @param {Object} copy - Localized UI strings
 */
function decorateCarousel(block, rows, copy) {
  block.setAttribute('role', 'region');
  block.setAttribute('aria-label', copy.carousel || 'Carousel');
  block.setAttribute('aria-roledescription', copy.carousel || 'Carousel');
  block.dataset.activeSlide = '0';

  const wrapper = document.createElement('div');
  wrapper.className = 'slides-wrapper';

  const slidesList = document.createElement('ul');
  slidesList.className = 'slides';

  const indicators = document.createElement('ol');
  indicators.className = 'indicators';
  const indicatorsNav = document.createElement('nav');
  indicatorsNav.setAttribute('aria-label', copy.slideIndicators || 'Slide indicators');
  indicatorsNav.append(indicators);

  rows.forEach((row, i) => {
    decorateSlide(row);

    const slide = document.createElement('li');
    slide.className = 'slide';
    slide.dataset.slideIndex = i;
    slide.setAttribute('aria-hidden', i !== 0);
    if (i !== 0) row.querySelectorAll('a[href]').forEach((a) => a.setAttribute('tabindex', '-1'));
    slide.append(row);
    slidesList.append(slide);

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.targetSlide = i;
    btn.setAttribute('aria-label', `${copy.showSlide || 'Show slide'} ${i + 1} ${copy.of || 'of'} ${rows.length}`);
    if (i === 0) { btn.setAttribute('disabled', true); btn.setAttribute('aria-current', 'true'); }
    li.append(btn);
    indicators.append(li);
  });

  const controls = document.createElement('nav');
  controls.className = 'controls';
  controls.setAttribute('aria-label', copy.slideNavigation || 'Slide navigation');
  controls.append(
    makeNavButton('prev', copy.previousSlide || 'Previous slide', true),
    makeNavButton('next', copy.nextSlide || 'Next slide', false),
  );
  decorateIcons(controls);

  wrapper.append(slidesList, controls);
  block.prepend(wrapper);
  block.append(indicatorsNav);
  bindEvents(block);
}

export default async function decorate(block) {
  const heading = block.querySelector('h1, h2, h3, h4, h5, h6');
  if (!heading || heading.tagName !== 'H1') {
    block.classList.add('teaser');
    const heroContainer = block.closest('.hero-container');
    if (heroContainer) heroContainer.classList.add('teaser');
  }

  const rows = [...block.querySelectorAll(':scope > div')];

  if (block.classList.contains('carousel') && rows.length > 1) {
    const copy = await loadCopy(import.meta.url);
    decorateCarousel(block, rows, copy);
    return;
  }

  decorateSlide(rows[0]);
}
