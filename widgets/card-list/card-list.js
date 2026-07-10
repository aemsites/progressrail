import { decorateBlock, loadBlock } from '../../scripts/aem.js';
import {
  getLocale, loadIndex, isDirectChild, buildCardRow,
} from '../../scripts/scripts.js';

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
