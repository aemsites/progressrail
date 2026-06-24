/**
 * Configures ambient video and unwraps pictures.
 * @param {HTMLElement} col
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

export default function decorate(block) {
  const cols = [...block.querySelectorAll(':scope > div > div')];

  const mediaCol = cols.find((col) => {
    const els = [...col.children];
    return els.length > 0 && els.every((el) => {
      if (el.tagName === 'VIDEO' || el.tagName === 'PICTURE') return true;
      return el.tagName === 'P' && el.children.length === 1 && el.children[0].tagName === 'PICTURE';
    });
  });
  mediaCol.className = 'media-wrapper';
  decorateMedia(mediaCol);

  const bodyCol = cols.find((col) => col !== mediaCol);
  bodyCol.className = 'body-wrapper';

  if (cols[0] === mediaCol) block.dataset.body = 'right';

  const heading = block.querySelector('h1, h2, h3, h4, h5, h6');
  if (!heading || heading.tagName !== 'H1') {
    block.classList.add('teaser');
    block.closest('.hero-container').classList.add('teaser');
  }
}
