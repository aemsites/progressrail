import { createOptimizedPicture } from '../../scripts/aem.js';

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

/** @param {Element} block */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      const els = [...col.children];
      const isMedia = els.length > 0 && els.every((el) => el.tagName === 'PICTURE' || el.tagName === 'VIDEO');
      col.classList.add(isMedia ? 'media-wrapper' : 'body-wrapper');
    });
    if (row.querySelector('.media-wrapper')) row.dataset.row = 'media';
  });

  const colCount = getColCount(block);
  if (colCount && ![...block.classList].some((c) => c.startsWith('cols-'))) {
    block.classList.add(`cols-${colCount}`);
    if (colCount % 2 === 0) block.classList.add('cols-even');
  }

  optimizeImages(block);
}
