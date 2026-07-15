import { loadCopy, createYouTubeEmbed, createPlaceholder } from '../../scripts/scripts.js';

/**
 * Returns the video provider name for a supported URL.
 * @param {string} url - the video page URL to inspect
 * @returns {string|null} provider name (e.g. 'youtube')
 */
function detectType(url) {
  const { hostname } = new URL(url);
  if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) return 'youtube';
  return null;
}

/**
 * Builds an embed iframe for the given provider type and URL.
 * @param {string} type - provider name returned by detectType
 * @param {string} url - the video URL to embed
 * @param {Object} copy - Localized UI strings
 * @returns {HTMLIFrameElement|null} embed iframe
 */
function createEmbed(type, url, copy) {
  if (type === 'youtube') return createYouTubeEmbed(url, copy);
  return null;
}

/**
 * Removes the block and its section wrapper from the DOM.
 * @param {HTMLElement} block - the block element to remove
 */
function removeBlock(block) {
  const wrapper = block.closest('.video-wrapper');
  if (wrapper) wrapper.remove();
}

export default async function decorate(block) {
  const copy = await loadCopy(import.meta.url);
  const link = block.querySelector('a[href]');
  if (!link) { removeBlock(block); return; }

  const type = detectType(link.href);
  if (!type) { removeBlock(block); return; }
  block.dataset.source = type;

  const embed = createEmbed(type, link.href, copy);
  if (!embed) { removeBlock(block); return; }

  const placeholder = createPlaceholder(block.querySelector('picture, img'), () => {
    const src = new URL(embed.src);
    src.searchParams.set('autoplay', 1);
    embed.src = src.href;
    if (!embed.isConnected) block.append(embed);
  });

  block.textContent = '';
  if (placeholder) block.append(placeholder);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      block.append(embed);
      observer.disconnect();
    });
  }, { rootMargin: '0px' });
  observer.observe(block);
}
