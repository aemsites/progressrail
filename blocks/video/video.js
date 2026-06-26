import { decorateIcons } from '../../scripts/aem.js';

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
 * Builds a YouTube iframe.
 * @param {string} url - the video page or short URL to parse
 * @returns {HTMLIFrameElement|null} configured embed iframe
 */
function createYouTubeEmbed(url) {
  const { hostname, pathname, searchParams } = new URL(url);
  const id = hostname === 'youtu.be' ? pathname.slice(1) : searchParams.get('v');
  if (!id) return null;

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${id}`;
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  iframe.title = 'YouTube video'; // TODO: localization
  return iframe;
}

/**
 * Builds an embed iframe for the given provider type and URL.
 * @param {string} type - provider name returned by detectType
 * @param {string} url - the video URL to embed
 * @returns {HTMLIFrameElement|null} embed iframe
 */
function createEmbed(type, url) {
  if (type === 'youtube') return createYouTubeEmbed(url);
  return null;
}

/**
 * Builds a thumbnail overlay.
 * @param {HTMLElement} block - block element containing the authored thumbnail image
 * @param {HTMLIFrameElement} embed - video iframe
 * @returns {HTMLElement|null} the placeholder figure
 */
function createPlaceholder(block, embed) {
  const image = block.querySelector('picture, img');
  if (!image) return null;

  const figure = document.createElement('figure');
  figure.classList.add('placeholder');
  figure.setAttribute('role', 'button');
  figure.setAttribute('tabindex', '0');
  figure.append(image);

  const icon = document.createElement('span');
  icon.className = 'icon icon-play';
  figure.append(icon);
  decorateIcons(figure);

  function play() {
    const src = new URL(embed.src);
    src.searchParams.set('autoplay', 1);
    embed.src = src.href;
    figure.remove();
  }

  figure.addEventListener('click', play);
  figure.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      play();
    }
  });

  return figure;
}

/**
 * Removes the block and its section wrapper from the DOM.
 * @param {HTMLElement} block - the block element to remove
 */
function removeBlock(block) {
  const wrapper = block.closest('.video-wrapper');
  if (wrapper) wrapper.remove();
}

export default function decorate(block) {
  const link = block.querySelector('a[href]');
  if (!link) { removeBlock(block); return; }

  const type = detectType(link.href);
  if (!type) { removeBlock(block); return; }
  block.dataset.source = type;

  const embed = createEmbed(type, link.href);
  if (!embed) { removeBlock(block); return; }

  const placeholder = createPlaceholder(block, embed);

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
