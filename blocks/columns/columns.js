import { createOptimizedPicture } from '../../scripts/aem.js';
import { transformVideoLinks } from '../../scripts/scripts.js';

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
 * Checks whether a loaded image should be shown with `contain` instead of `cover`.
 * @param {HTMLImageElement} img The loaded image element
 * @returns {boolean} `true` if the image has any non-opaque pixels or a solid white background
 */
function shouldContain(img) {
  try {
    const size = 100;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);

    const isWhite = (i) => data[i + 3] === 255
      && data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250;

    const corners = [
      0,
      (size - 1) * 4,
      (size - 1) * size * 4,
      ((size - 1) * size + (size - 1)) * 4,
    ];

    if (corners.every(isWhite)) return true;

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Adds a `contain` class to images that should not be cropped.
 * @param {Element} block The columns block element
 */
function detectContainMedia(block) {
  block.querySelectorAll('.media-wrapper picture > img').forEach((img) => {
    const check = () => {
      if (shouldContain(img)) img.classList.add('contain');
    };
    if (img.complete) check();
    else img.addEventListener('load', check, { once: true });
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
      if (els.length === 1 && els[0].classList.contains('video-embed')) col.dataset.media = 'video';
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
  detectContainMedia(block);
}
