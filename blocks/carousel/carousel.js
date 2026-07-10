// eslint-disable-next-line import/no-cycle
import { buildVideoAutoBlocks, getLocale } from '../../scripts/scripts.js';
import { decorateBlock, loadBlock } from '../../scripts/aem.js';

const CAROUSEL_VARIANTS = ['slides', 'promo'];

function resolveVariant(block) {
  const selected = CAROUSEL_VARIANTS.find((name) => block.classList.contains(name));
  if (selected) return selected;
  block.classList.add('promo');
  return 'promo';
}

async function loadCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return {};
    const data = await resp.json();
    return data[lang] || data.en || {};
  } catch {
    return {};
  }
}

function updateNavigation(block, slideIndex) {
  const slides = block.querySelectorAll('.carousel-slide');
  const prev = block.querySelector('.slide-prev');
  const next = block.querySelector('.slide-next');
  if (!prev || !next) return;

  prev.hidden = slideIndex <= 0;
  next.hidden = slideIndex >= slides.length - 1;
}

function updateSlidesFooter(block, slideIndex) {
  if (!block.classList.contains('slides')) return;

  const slides = block.querySelectorAll('.carousel-slide');
  const slide = slides[slideIndex];
  const countEl = block.querySelector('.carousel-slide-count');
  const captionEl = block.querySelector('.carousel-caption');
  const of = block.dataset.slideOf || 'of';

  if (countEl) {
    if (slides.length > 1) {
      countEl.hidden = false;
      countEl.textContent = `${slideIndex + 1} ${of} ${slides.length}`;
    } else {
      countEl.hidden = true;
      countEl.textContent = '';
    }
  }

  if (captionEl) {
    captionEl.textContent = slide?.dataset.caption || '';
  }
}

function updateActiveSlide(slide) {
  const block = slide.closest('.carousel');
  const slideIndex = parseInt(slide.dataset.slideIndex, 10);
  block.dataset.activeSlide = slideIndex;

  const slides = block.querySelectorAll('.carousel-slide');

  slides.forEach((aSlide, idx) => {
    aSlide.setAttribute('aria-hidden', idx !== slideIndex);
    aSlide.querySelectorAll('a').forEach((link) => {
      if (idx !== slideIndex) {
        link.setAttribute('tabindex', '-1');
      } else {
        link.removeAttribute('tabindex');
      }
    });
  });

  block.querySelectorAll('.carousel-slide-indicator button').forEach((button, idx) => {
    if (idx !== slideIndex) {
      button.removeAttribute('disabled');
      button.removeAttribute('aria-current');
    } else {
      button.setAttribute('disabled', true);
      button.setAttribute('aria-current', true);
    }
  });

  block.querySelectorAll('.carousel-thumbnail').forEach((button, idx) => {
    if (idx === slideIndex) {
      button.setAttribute('aria-current', 'true');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  updateSlidesFooter(block, slideIndex);
  updateNavigation(block, slideIndex);
}

function showSlide(block, slideIndex = 0) {
  const slides = block.querySelectorAll('.carousel-slide');
  const realSlideIndex = Math.max(0, Math.min(slideIndex, slides.length - 1));
  const activeSlide = slides[realSlideIndex];

  activeSlide.querySelectorAll('a').forEach((link) => link.removeAttribute('tabindex'));
  updateActiveSlide(activeSlide);
  block.querySelector('.carousel-slides').scrollTo({
    top: 0,
    left: activeSlide.offsetLeft,
    behavior: 'smooth',
  });
}

function bindEvents(block) {
  block.querySelectorAll('.carousel-thumbnail, .carousel-slide-indicator button').forEach((button) => {
    button.addEventListener('click', (e) => {
      const control = e.currentTarget;
      const targetSlide = control.dataset.targetSlide
        ?? control.closest('[data-target-slide]')?.dataset.targetSlide;
      showSlide(block, parseInt(targetSlide, 10));
    });
  });

  const prev = block.querySelector('.slide-prev');
  const next = block.querySelector('.slide-next');
  if (prev) {
    prev.addEventListener('click', () => {
      const idx = parseInt(block.dataset.activeSlide, 10);
      if (idx > 0) showSlide(block, idx - 1);
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      const idx = parseInt(block.dataset.activeSlide, 10);
      const slides = block.querySelectorAll('.carousel-slide');
      if (idx < slides.length - 1) showSlide(block, idx + 1);
    });
  }

  const slideObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) updateActiveSlide(entry.target);
    });
  }, { threshold: 0.5 });
  block.querySelectorAll('.carousel-slide').forEach((slide) => {
    slideObserver.observe(slide);
  });
}

function isMediaColumn(col) {
  const els = [...col.children];
  return els.length > 0 && els.every((el) => {
    if (el.tagName === 'VIDEO' || el.tagName === 'PICTURE') return true;
    return el.tagName === 'P' && el.children.length === 1 && el.children[0].tagName === 'PICTURE';
  });
}

function isYouTubeLink(el) {
  const link = el.tagName === 'A' ? el : el.querySelector('a[href]');
  if (!link) return false;
  try {
    const { hostname } = new URL(link.href);
    return hostname === 'youtu.be' || hostname.endsWith('youtube.com');
  } catch {
    return false;
  }
}

function attachPosterToVideoBlock(videoBlock) {
  if (videoBlock.querySelector('picture, img')) return;
  const anchor = videoBlock.closest('p') || videoBlock;
  const prev = anchor.previousElementSibling;
  if (!prev) return;
  if (prev.matches('picture, img')) {
    videoBlock.prepend(prev);
    return;
  }
  if (prev.tagName === 'P' && !prev.querySelector('a[href]')) {
    const pic = prev.querySelector(':scope > picture, :scope > img');
    if (pic) videoBlock.prepend(pic);
  }
}

async function loadSlideVideos(block) {
  const videos = [...block.querySelectorAll('.carousel-slide-media .video')];
  await Promise.all(videos.map(async (videoBlock) => {
    decorateBlock(videoBlock);
    await loadBlock(videoBlock);
  }));
}

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

function layoutPromoSlide(row, slide) {
  const cols = [...row.querySelectorAll(':scope > div')];
  const mediaCol = cols.find(isMediaColumn);
  const bodyCol = cols.find((col) => col !== mediaCol);

  if (!mediaCol || !bodyCol) {
    cols.forEach((column, colIdx) => {
      column.classList.add(`carousel-slide-${colIdx === 0 ? 'image' : 'content'}`);
      slide.append(column);
    });
    return;
  }

  mediaCol.className = 'media-wrapper';
  decorateMedia(mediaCol);
  bodyCol.className = 'body-wrapper';

  if (cols[0] === mediaCol) slide.dataset.body = 'right';

  slide.append(row);

  const heading = slide.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading?.id) {
    slide.setAttribute('aria-labelledby', heading.id);
  }
}

function layoutGallerySlide(row, slide) {
  const column = row.querySelector(':scope > div');
  if (!column) return;

  buildVideoAutoBlocks(column);
  column.querySelectorAll('.video').forEach(attachPosterToVideoBlock);

  const media = document.createElement('div');
  media.className = 'carousel-slide-media';
  const captions = [];

  [...column.children].forEach((child) => {
    const isCaption = child.tagName === 'P'
      && !isYouTubeLink(child)
      && child.textContent.trim();
    if (isCaption) {
      captions.push(child.textContent.trim());
    } else {
      media.append(child);
    }
  });

  if (captions.length) {
    slide.dataset.caption = captions.join(' ');
  }

  slide.append(media);
}

function getSlideThumbnail(slide) {
  const img = slide.querySelector('.carousel-slide-media picture img, .carousel-slide-media img');
  if (!img?.src) return null;
  return { src: img.src, alt: img.alt || '' };
}

function createThumbnail(slide, idx, total, copy, thumbList) {
  const thumb = getSlideThumbnail(slide);
  if (!thumb) return;

  const item = document.createElement('li');
  item.dataset.targetSlide = idx;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'carousel-thumbnail';
  button.dataset.targetSlide = idx;
  button.setAttribute(
    'aria-label',
    `${copy.showSlide || 'Show Slide'} ${idx + 1} ${copy.of || 'of'} ${total}`,
  );

  const img = document.createElement('img');
  img.src = thumb.src;
  img.alt = thumb.alt;
  button.append(img);
  item.append(button);
  thumbList.append(item);
}

function createSlide(row, slideIndex, carouselId, variant) {
  const slide = document.createElement('li');
  slide.dataset.slideIndex = slideIndex;
  slide.setAttribute('id', `carousel-${carouselId}-slide-${slideIndex}`);
  slide.classList.add('carousel-slide');

  if (variant === 'slides') {
    layoutGallerySlide(row, slide);
  } else {
    layoutPromoSlide(row, slide);
  }

  return slide;
}

let carouselId = 0;
export default async function decorate(block) {
  carouselId += 1;
  block.setAttribute('id', `carousel-${carouselId}`);
  const variant = resolveVariant(block);
  if (variant === 'promo') {
    block.classList.add('teaser');
    block.closest('.carousel-container')?.classList.add('teaser');
  }
  const rows = block.querySelectorAll(':scope > div');
  const isSingleSlide = rows.length < 2;
  const isSlides = variant === 'slides';

  const copy = await loadCopy(getLocale());
  block.dataset.slideOf = copy.of || 'of';

  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', copy.carousel || 'Carousel');

  const container = document.createElement('div');
  container.classList.add('carousel-slides-container');
  if (isSlides) container.classList.add('carousel-slides-layout');

  const slidesWrapper = document.createElement('ul');
  slidesWrapper.classList.add('carousel-slides');

  let slideIndicators;
  let thumbNav;
  let thumbList;
  let main;

  if (isSlides) {
    main = document.createElement('div');
    main.classList.add('carousel-main');
    if (!isSingleSlide) {
      thumbNav = document.createElement('nav');
      thumbNav.classList.add('carousel-thumbnails');
      thumbNav.setAttribute('aria-label', copy.carouselSlideControls || 'Carousel Slide Controls');
      thumbList = document.createElement('ol');
      thumbNav.append(thumbList);
    }
  }

  let slideNavButtons;
  if (!isSingleSlide) {
    slideNavButtons = document.createElement('div');
    slideNavButtons.classList.add('carousel-navigation-buttons');
    slideNavButtons.innerHTML = `
      <button type="button" class="slide-prev" aria-label="${copy.previousSlide || 'Previous Slide'}"></button>
      <button type="button" class="slide-next" aria-label="${copy.nextSlide || 'Next Slide'}"></button>
    `;

    if (isSlides) {
      main.append(slideNavButtons);
    } else {
      container.append(slideNavButtons);

      const slideIndicatorsNav = document.createElement('nav');
      slideIndicatorsNav.setAttribute('aria-label', copy.carouselSlideControls || 'Carousel Slide Controls');
      slideIndicators = document.createElement('ol');
      slideIndicators.classList.add('carousel-slide-indicators');
      slideIndicatorsNav.append(slideIndicators);
      block.append(slideIndicatorsNav);
    }
  }

  rows.forEach((row, idx) => {
    const slide = createSlide(row, idx, carouselId, variant);
    slidesWrapper.append(slide);

    if (slideIndicators) {
      const indicator = document.createElement('li');
      indicator.classList.add('carousel-slide-indicator');
      indicator.dataset.targetSlide = idx;
      indicator.innerHTML = `<button type="button" data-target-slide="${idx}" aria-label="${copy.showSlide || 'Show Slide'} ${idx + 1} ${copy.of || 'of'} ${rows.length}"></button>`;
      slideIndicators.append(indicator);
    }

    if (thumbList) {
      createThumbnail(slide, idx, rows.length, copy, thumbList);
    }

    if (row.parentElement === block) {
      row.remove();
    }
  });

  if (isSlides) {
    main.append(slidesWrapper);
    if (thumbNav) container.append(thumbNav);
    container.append(main);
    block.prepend(container);

    const footer = document.createElement('div');
    footer.className = 'carousel-footer';
    footer.innerHTML = '<p class="carousel-slide-count"></p><p class="carousel-caption"></p>';
    block.append(footer);
  } else {
    container.append(slidesWrapper);
    block.prepend(container);
  }

  if (!isSingleSlide) {
    bindEvents(block);
    const firstSlide = block.querySelector('.carousel-slide');
    if (firstSlide) updateActiveSlide(firstSlide);
  } else if (isSlides) {
    const firstSlide = block.querySelector('.carousel-slide');
    if (firstSlide) updateSlidesFooter(block, 0);
  }

  if (isSlides) {
    await loadSlideVideos(block);
  }
}
