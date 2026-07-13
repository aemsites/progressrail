import { isYouTubeHref, loadCopy } from '../../scripts/scripts.js';
import { createOptimizedPicture, decorateIcons } from '../../scripts/aem.js';
import { createYouTubeEmbed, createPlaceholder } from '../video/video.js';

/**
 * Returns `true` if a column child is a paragraph containing a single YouTube link.
 * @param {HTMLElement} el - Column child element to test
 * @returns {boolean}
 */
function isVideoLink(el) {
  if (el.tagName !== 'P' || el.children.length !== 1) return false;
  const a = el.firstElementChild;
  return a.tagName === 'A' && isYouTubeHref(a.href);
}

/**
 * Replaces a media column's YouTube link with a lazy-loaded embed behind a poster placeholder.
 * @param {HTMLElement} col - Media column containing the link
 * @param {string} href - YouTube URL to embed
 */
function decorateVideo(col, href) {
  const embed = createYouTubeEmbed(href);
  if (!embed) return;

  const container = document.createElement('div');
  container.className = 'video-embed';

  const picture = col.querySelector('picture');
  const placeholder = createPlaceholder(picture, () => {
    const src = new URL(embed.src);
    src.searchParams.set('autoplay', 1);
    embed.src = src.href;
    if (!embed.isConnected) container.append(embed);
  });

  if (placeholder) container.append(placeholder);
  col.replaceChildren(container);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      container.append(embed);
      observer.disconnect();
    });
  }, { threshold: 1 });
  observer.observe(container);
}

/**
 * Finds a YouTube link in a media column and converts it to a video embed.
 * @param {HTMLElement} col - Media column to inspect and potentially transform
 */
function transformVideoLinks(col) {
  const videoLink = [...col.children].find(isVideoLink);
  if (videoLink) decorateVideo(col, videoLink.firstElementChild.href);
}

/**
 * Builds a slide's media figure and caption from the row's media/caption columns.
 * @param {HTMLElement} row - Authored row div with one or two column divs
 * @param {HTMLElement} slide - Slide list item to populate
 * @param {number} slideIndex - Zero-based index of this slide
 * @param {number} total - Total number of slides in the gallery
 * @param {Object} copy - Localized UI strings
 */
function layoutGallerySlide(row, slide, slideIndex, total, copy) {
  const [mediaCol, captionCol] = row.querySelectorAll(':scope > div');
  if (!mediaCol) return;

  transformVideoLinks(mediaCol);
  mediaCol.className = 'media-wrapper';

  const figure = document.createElement('figure');
  figure.append(mediaCol);
  slide.append(figure);

  const hasCaption = captionCol && captionCol.textContent.trim();
  if (total > 1 || hasCaption) {
    const figcaption = document.createElement('figcaption');
    figcaption.className = 'body-wrapper';
    if (total > 1) {
      const count = document.createElement('p');
      count.className = 'count';
      count.textContent = `${slideIndex + 1} ${copy.of || 'of'} ${total}`;
      figcaption.append(count);
    }
    if (hasCaption) figcaption.append(...captionCol.children);
    figure.append(figcaption);
  }
}

/**
 * Returns the source image src/alt to build a slide's thumbnail from, or `null` if none.
 * @param {HTMLElement} slide - Slide list item
 * @returns {{src: string, alt: string}|null}
 */
function getSlideThumbnail(slide) {
  const img = slide.querySelector('.media-wrapper img');
  if (!img || !img.src) return null;
  return { src: img.src, alt: img.alt || '' };
}

/**
 * Creates a low-res thumbnail button for a slide, skipping slides with no usable image.
 * @param {HTMLElement} slide - Slide the thumbnail navigates to
 * @param {number} i - Zero-based index of the slide
 * @param {number} total - Total number of slides in the gallery
 * @param {Object} copy - Localized UI strings
 * @param {HTMLOListElement} thumbList - List to append the thumbnail item to
 */
function createThumbnail(slide, i, total, copy, thumbList) {
  const thumb = getSlideThumbnail(slide);
  if (!thumb) return;

  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thumbnail';
  button.dataset.targetSlide = i;
  button.setAttribute('aria-label', `${copy.showSlide || 'Show Slide'} ${i + 1} ${copy.of || 'of'} ${total}`);
  button.append(createOptimizedPicture(thumb.src, thumb.alt, false, [{ width: '150' }]));
  item.append(button);
  thumbList.append(item);
}

/**
 * Creates a slide list item and lays out its content from the authored row.
 * @param {HTMLElement} row - Authored row div for this slide
 * @param {number} slideIndex - Zero-based index of this slide
 * @param {number} total - Total number of slides in the gallery
 * @param {Object} copy - Localized UI strings
 * @param {number} id - Gallery instance id, used to build a unique slide id
 * @returns {HTMLLIElement}
 */
function createSlide(row, slideIndex, total, copy, id) {
  const slide = document.createElement('li');
  slide.dataset.slideIndex = slideIndex;
  slide.setAttribute('id', `gallery-${id}-slide-${slideIndex}`);
  slide.classList.add('slide');
  layoutGallerySlide(row, slide, slideIndex, total, copy);
  return slide;
}

/**
 * Shows or hides the prev/next buttons based on how close the active slide is to either end.
 * @param {HTMLElement} block - Gallery block element
 * @param {number} slideIndex - Active slide index
 */
function updateNavigation(block, slideIndex) {
  const slides = block.querySelectorAll('.slide');
  const prev = block.querySelector('.controls .prev');
  const next = block.querySelector('.controls .next');
  if (!prev || !next) return;

  prev.hidden = slideIndex <= 0;
  next.hidden = slideIndex >= slides.length - 1;
}

/**
 * Syncs aria-hidden, tabindex, and the active thumbnail to the given slide.
 * @param {HTMLElement} slide - Slide to mark as active
 */
function updateActiveSlide(slide) {
  const block = slide.closest('.gallery');
  const slideIndex = parseInt(slide.dataset.slideIndex, 10);
  block.dataset.activeSlide = slideIndex;

  block.querySelectorAll('.slide').forEach((aSlide, i) => {
    const hidden = i !== slideIndex;
    aSlide.setAttribute('aria-hidden', hidden);
    aSlide.querySelectorAll('a[href], iframe').forEach((el) => {
      if (hidden) el.setAttribute('tabindex', '-1');
      else el.removeAttribute('tabindex');
    });
    aSlide.querySelectorAll('[role="button"]').forEach((el) => {
      el.setAttribute('tabindex', hidden ? '-1' : '0');
    });
  });

  block.querySelectorAll('.thumbnail').forEach((button, i) => {
    if (i === slideIndex) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });

  updateNavigation(block, slideIndex);
}

/**
 * Whether the user has requested reduced motion.
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolls to a target slide index and syncs all active state.
 * @param {HTMLElement} block - Gallery block element
 * @param {number} slideIndex - Target slide index (clamped to valid range)
 */
function showSlide(block, slideIndex = 0) {
  const slides = block.querySelectorAll('.slide');
  const realSlideIndex = Math.max(0, Math.min(slideIndex, slides.length - 1));
  const activeSlide = slides[realSlideIndex];

  updateActiveSlide(activeSlide);
  block.querySelector('.slides').scrollTo({
    top: 0,
    left: activeSlide.offsetLeft,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

/**
 * Attaches click handlers to thumbnails/arrows and an IntersectionObserver to keep
 * the active slide in sync.
 * @param {HTMLElement} block - Gallery block element
 */
function bindEvents(block) {
  block.querySelectorAll('.thumbnail').forEach((button) => {
    button.addEventListener('click', (e) => {
      showSlide(block, parseInt(e.currentTarget.dataset.targetSlide, 10));
    });
  });

  const prev = block.querySelector('.controls .prev');
  const next = block.querySelector('.controls .next');
  if (prev) {
    prev.addEventListener('click', () => {
      const i = parseInt(block.dataset.activeSlide, 10);
      if (i > 0) showSlide(block, i - 1);
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      const i = parseInt(block.dataset.activeSlide, 10);
      const slides = block.querySelectorAll('.slide');
      if (i < slides.length - 1) showSlide(block, i + 1);
    });
  }

  const slideObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) updateActiveSlide(entry.target);
    });
  }, { threshold: 0.5 });
  block.querySelectorAll('.slide').forEach((slide) => slideObserver.observe(slide));
}

let galleryId = 0;

/**
 * Builds the gallery: media slides, thumbnail nav, arrow controls, and behavior.
 * @param {HTMLElement} block - Gallery block element
 */
export default async function decorate(block) {
  galleryId += 1;
  block.setAttribute('id', `gallery-${galleryId}`);
  const rows = block.querySelectorAll(':scope > div');
  const isSingleSlide = rows.length < 2;

  const copy = await loadCopy(import.meta.url);
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', copy.gallery || 'Gallery');

  const slidesWrapper = document.createElement('div');
  slidesWrapper.className = 'slides-wrapper';

  const slidesList = document.createElement('ul');
  slidesList.className = 'slides';

  let thumbList;
  rows.forEach((row, i) => {
    const slide = createSlide(row, i, rows.length, copy, galleryId);
    slidesList.append(slide);
    if (!isSingleSlide) {
      if (!thumbList) thumbList = document.createElement('ol');
      createThumbnail(slide, i, rows.length, copy, thumbList);
    }
    if (row.parentElement === block) row.remove();
  });

  slidesWrapper.append(slidesList);

  if (!isSingleSlide) {
    const controls = document.createElement('nav');
    controls.className = 'controls';
    controls.innerHTML = `
      <button type="button" class="prev button" aria-label="${copy.previousSlide || 'Previous Slide'}">
        <span class="icon icon-chevron chevron-left"></span>
      </button>
      <button type="button" class="next button" aria-label="${copy.nextSlide || 'Next Slide'}">
        <span class="icon icon-chevron chevron-right"></span>
      </button>
    `;
    decorateIcons(controls);
    slidesWrapper.append(controls);
  }

  block.append(slidesWrapper);

  if (!isSingleSlide) {
    const thumbNav = document.createElement('nav');
    thumbNav.className = 'thumbnails';
    thumbNav.setAttribute('aria-label', copy.gallerySlideControls || 'Gallery Slide Controls');
    thumbNav.append(thumbList);
    block.append(thumbNav);

    bindEvents(block);
    updateActiveSlide(slidesList.querySelector('.slide'));
  }
}
