import {
  createOptimizedPicture, decorateBlock, loadBlock,
} from '../../scripts/aem.js';

function getLocale() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  if (segment && /^[a-z]{2}(-[a-z]{2})?$/i.test(segment)) {
    return segment.split('-')[0].toLowerCase();
  }
  return (document.documentElement.lang || 'en').split('-')[0].toLowerCase();
}

function resolveRoot(rootParam, lang) {
  const pagePath = window.location.pathname;
  if (!rootParam) return pagePath;
  if (rootParam === 'parent') {
    return pagePath.replace(/\/[^/]*\/?$/, '');
  }
  if (rootParam.startsWith('/')) {
    return `/${lang}${rootParam}`;
  }
  return pagePath;
}

function isDirectChild(itemPath, parentPath) {
  const normalized = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
  if (!itemPath.startsWith(`${normalized}/`)) return false;
  const rest = itemPath.slice(normalized.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

async function loadIndex(lang) {
  const base = window.hlx?.codeBasePath || '';
  const resp = await fetch(`${base}/${lang}/query-index.json`);
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

function buildCardRow(item, showDescription) {
  const row = document.createElement('div');

  if (item.image) {
    const mediaCell = document.createElement('div');
    const picture = createOptimizedPicture(item.image, item.title || '', false, [{ width: '750' }]);
    mediaCell.append(picture);
    row.append(mediaCell);
  }

  const bodyCell = document.createElement('div');
  if (item.title) {
    const heading = document.createElement('h3');
    const link = document.createElement('a');
    link.href = item.path;
    link.textContent = item.title;
    heading.append(link);
    bodyCell.append(heading);
  }
  if (showDescription && item.description) {
    const p = document.createElement('p');
    p.textContent = item.description;
    bodyCell.append(p);
  }
  row.append(bodyCell);

  return row;
}

export default async function decorate(widget) {
  const lang = getLocale();
  const rootParam = widget.dataset.root;
  const showDescription = widget.dataset.description !== 'false';

  const parentPath = resolveRoot(rootParam, lang);
  const index = await loadIndex(lang);
  const children = index.filter((item) => isDirectChild(item.path || item.url || '', parentPath));

  if (children.length === 0) return;

  const cardsBlock = document.createElement('div');
  cardsBlock.classList.add('cards');
  children.forEach((item) => {
    const normalized = { ...item, path: item.path || item.url || '' };
    cardsBlock.append(buildCardRow(normalized, showDescription));
  });

  const container = widget.querySelector('.card-list-cards');
  const wrapper = document.createElement('div');
  wrapper.append(cardsBlock);
  (container || widget).replaceChildren(wrapper);

  decorateBlock(cardsBlock);
  await loadBlock(cardsBlock);
}
