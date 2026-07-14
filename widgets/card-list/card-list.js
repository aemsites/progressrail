import { decorateBlock, loadBlock } from '../../scripts/aem.js';
import {
  getLocale, loadIndex, isDirectChild, buildCardRow,
} from '../../scripts/scripts.js';

const SHORT_DESCRIPTION_MAX = 100;

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

function isShortDescription(description) {
  const text = (description || '').trim();
  return text.length > 0 && text.length <= SHORT_DESCRIPTION_MAX;
}

function shouldShowDescriptions(items, descriptionParam) {
  if (descriptionParam === 'true') return true;
  if (descriptionParam === 'false') return false;
  return items.every((item) => isShortDescription(item.description));
}

export default async function decorate(widget) {
  const lang = getLocale();
  const rootParam = widget.dataset.root;

  const parentPath = resolveRoot(rootParam, lang);
  const currentPath = window.location.pathname;
  const index = await loadIndex(lang);
  const children = index.filter((item) => {
    const itemPath = item.path || item.url || '';
    return isDirectChild(itemPath, parentPath) && itemPath !== currentPath;
  });

  if (children.length === 0) return;

  const showDescription = shouldShowDescriptions(children, widget.dataset.description);

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
