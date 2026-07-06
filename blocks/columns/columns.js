import { createOptimizedPicture } from '../../scripts/aem.js';
import { isYouTubeHref } from '../../scripts/scripts.js';
import { createYouTubeEmbed, createPlaceholder } from '../video/video.js';

/**
 * Returns the shared column count if every row has the same number of columns.
 * @param {Element} block The block element
 * @returns {number|null} Column count, or `null` if rows differ
 */
function getColCount(block) {
  const rows = [...block.children];
  if (rows.length === 0) return null;
  const n = rows[0].children.length;
  return rows.every((row) => row.children.length === n) ? n : null;
}

/**
 * Replaces all images in the block with optimized picture elements.
 * @param {Element} block The columns block element
 */
function optimizeImages(block) {
  block.querySelectorAll('.media-wrapper picture > img').forEach((img) => {
    img.closest('picture').replaceWith(
      createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]),
    );
  });
}

/**
 * Marks body-only blocks whose last column is links-only with `action` and `action-wrapper`.
 * @param {Element} block The columns block element
 */
function detectAction(block) {
  const rows = [...block.children];
  if (!rows.length) return;
  const matches = rows.every((row) => {
    const cols = [...row.children];
    if (cols.some((col) => col.classList.contains('media-wrapper'))) return false;
    const last = cols[cols.length - 1];
    return [...last.children].every(
      (el) => el.tagName === 'P' && el.children.length === 1 && el.firstElementChild.tagName === 'A',
    );
  });
  if (!matches) return;
  block.classList.add('action');
  rows.forEach((row) => {
    const last = row.children[row.children.length - 1];
    last.classList.replace('body-wrapper', 'action-wrapper');
  });
}

/**
 * Returns true if el is a paragraph containing a single YouTube link.
 * @param {Element} el - The element to test
 * @returns {boolean}
 */
function isVideoLink(el) {
  if (el.tagName !== 'P' || el.children.length !== 1) return false;
  const a = el.firstElementChild;
  return a.tagName === 'A' && isYouTubeHref(a.href);
}

/**
 * Transforms a media column with a YouTube link into a video embed.
 * @param {Element} col - The column element to transform
 * @param {string} href - The YouTube URL to embed
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
  col.dataset.media = 'video';

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      container.append(embed);
      observer.disconnect();
    });
  }, { rootMargin: '0px' });
  observer.observe(container);
}

/**
 * Transforms a video link in a media-only column into a video embed.
 * @param {Element} col - Column element to inspect and potentially transform
 */
function transformVideoLinks(col) {
  const videoLinkEl = [...col.children].find(isVideoLink);
  if (videoLinkEl) {
    const nonVideo = [...col.children].filter((el) => el !== videoLinkEl);
    const isPictureParagraph = (el) => el.tagName === 'P'
      && el.children.length === 1
      && el.firstElementChild.tagName === 'PICTURE';
    if (nonVideo.every((el) => el.tagName === 'PICTURE' || el.tagName === 'VIDEO' || isPictureParagraph(el))) {
      decorateVideo(col, videoLinkEl.firstElementChild.href);
    }
  }
}

/** @param {Element} block */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      transformVideoLinks(col);

      const els = [...col.children];
      const isMedia = els.length > 0 && els.every(
        (el) => el.tagName === 'PICTURE'
          || el.tagName === 'VIDEO'
          || el.classList.contains('video-embed'),
      );
      col.classList.add(isMedia ? 'media-wrapper' : 'body-wrapper');
    });
    if (row.querySelector('.media-wrapper')) row.dataset.row = 'media';
  });

  detectAction(block);

  const colCount = getColCount(block);
  if (colCount && ![...block.classList].some((c) => c.startsWith('cols-'))) {
    block.classList.add(`cols-${colCount}`);
    if (colCount % 2 === 0) block.classList.add('cols-even');
  }

  optimizeImages(block);
}
