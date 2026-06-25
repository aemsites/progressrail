import { createOptimizedPicture, decorateIcons } from '../../scripts/aem.js';

/**
 * Returns the largest factor of the block's row count between 1 and 6.
 * @param {Element} block The cards block element
 * @returns {number} Grid column count to apply as a cols-N class
 */
function getGridFactor(block) {
  const rows = block.children.length;
  for (let n = 6; n >= 2; n -= 1) {
    if (rows % n === 0) return n;
  }
  return rows === 1 ? 1 : 3;
}

/**
 * Moves a trailing CTA out of .body-wrapper into a card footer.
 * @param {HTMLElement} card The card <li> element being decorated
 */
function extractButtons(card) {
  const body = card.querySelector('.body-wrapper');
  if (!body) return;
  const last = body.lastElementChild;
  if (!last) return;

  const isButtonWrapper = last.classList.contains('button-wrapper');
  const isLoneLink = last.tagName === 'P'
    && last.querySelectorAll('a[href]').length === 1
    && last.textContent.trim() === last.querySelector('a[href]').textContent.trim();

  if (!isButtonWrapper && !isLoneLink) return;
  const footer = document.createElement('footer');
  footer.append(last);
  card.append(footer);
}

/**
 * Marks a card as fully clickable when it contains exactly one link.
 * @param {HTMLElement} card The card <li> element being decorated
 */
function linkCard(card) {
  const links = [...card.querySelectorAll('a[href]')];
  if (links.length !== 1) return;
  card.classList.add('linked');
}

/**
 * Replaces all images in the block with optimized picture elements.
 * @param {Element} block The cards block element
 */
function optimizeImages(block) {
  block.querySelectorAll('.media-wrapper picture > img').forEach((img) => {
    img.closest('picture').replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]));
  });
}

export default function decorate(block) {
  if (![...block.classList].some((c) => c.startsWith('cols-'))) {
    block.classList.add(`cols-${getGridFactor(block)}`);
  }

  const ul = document.createElement('ul');
  [...block.children].forEach((card) => {
    const li = document.createElement('li');
    [...card.children].forEach((cell) => {
      const els = [...cell.children];
      const isMedia = els.length > 0 && els.every((el) => el.tagName === 'PICTURE' || el.tagName === 'VIDEO');
      cell.classList.add(isMedia ? 'media-wrapper' : 'body-wrapper');
      li.append(cell);
    });
    extractButtons(li);
    linkCard(li);
    ul.append(li);
  });

  block.replaceChildren(ul);

  optimizeImages(block);
  decorateIcons(block);
}
