import { decorateBlock, loadBlock } from '../../scripts/aem.js';
import {
  getLocale, loadIndex, isDirectChild, buildCardRow,
} from '../../scripts/scripts.js';

const SHORT_DESCRIPTION_MAX = 100;

function getLocaleFromPath(path) {
  const segment = (path || '').split('/').filter(Boolean)[0];
  if (segment && /^[a-z]{2}(-[a-z]{2})?$/i.test(segment)) return segment;
  return getLocale();
}

function resolveRoot(rootParam, lang, pagePath) {
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

async function renderPreview(container, {
  rootParam, descriptionParam, pagePath,
}) {
  const lang = getLocaleFromPath(pagePath);
  const parentPath = resolveRoot(rootParam, lang, pagePath);
  const index = await loadIndex(lang);
  const children = index.filter((item) => {
    const itemPath = item.path || item.url || '';
    return isDirectChild(itemPath, parentPath) && itemPath !== pagePath;
  });

  container.replaceChildren();

  if (children.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-list-config-empty';
    empty.textContent = 'No child pages found for this configuration.';
    container.append(empty);
    return { parentPath, childCount: 0 };
  }

  const showDescription = shouldShowDescriptions(children, descriptionParam);
  const cardsBlock = document.createElement('div');
  cardsBlock.classList.add('cards');
  children.forEach((item) => {
    const normalized = { ...item, path: item.path || item.url || '' };
    cardsBlock.append(buildCardRow(normalized, showDescription));
  });

  const wrapper = document.createElement('div');
  wrapper.append(cardsBlock);
  container.append(wrapper);
  decorateBlock(cardsBlock);
  await loadBlock(cardsBlock);
  return { parentPath, childCount: children.length };
}

/**
 * Derives the authored page path from the da.live editor referrer hash.
 * @returns {string} Path such as `/en/company`, or empty if unavailable
 */
function getReferrerPagePath() {
  const { referrer } = document;
  if (!referrer) return '';
  try {
    const { hash } = new URL(referrer);
    const hashPath = hash.replace(/^#/, '');
    if (!hashPath) return '';
    const segments = hashPath.split('/').filter(Boolean);
    if (segments.length <= 2) return '';
    return `/${segments.slice(2).join('/')}`;
  } catch {
    return '';
  }
}

function buildWidgetHref({ root, description }) {
  const base = `${window.location.origin}${window.hlx?.codeBasePath || ''}/widgets/card-list/card-list.html`;
  const params = new URLSearchParams();
  if (root) params.set('root', root);
  if (description) params.set('description', description);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function readConfigFromSearch() {
  const params = new URLSearchParams(window.location.search);
  const root = params.get('root') || '';
  const description = params.get('description') || '';
  const isCustomRoot = root && root !== 'parent';
  return {
    root: isCustomRoot ? '__custom__' : root,
    rootPath: isCustomRoot ? root : '',
    description: description || 'auto',
  };
}

function configToParams({ root, rootPath, description }) {
  let rootParam = '';
  if (root === 'parent') rootParam = 'parent';
  if (root === '__custom__') rootParam = rootPath.trim();
  const descriptionParam = description === 'auto' ? '' : description;
  return { root: rootParam, description: descriptionParam };
}

function buildControl(label, name, options, value) {
  const item = document.createElement('label');
  item.className = 'card-list-config-item';
  const text = document.createElement('span');
  text.textContent = label;
  const select = document.createElement('select');
  select.name = name;
  options.forEach(({ val, text: optionText }) => {
    const option = document.createElement('option');
    option.value = val;
    option.textContent = optionText;
    option.selected = val === value;
    select.append(option);
  });
  item.append(text, select);
  return { item, select };
}

function buildConfigPanel(widget, pagePath) {
  const initial = readConfigFromSearch();
  const panel = document.createElement('div');
  panel.className = 'card-list-config';

  const controls = document.createElement('div');
  controls.className = 'card-list-config-controls';

  const rootOptions = [
    { val: '', text: 'Self' },
    { val: 'parent', text: 'Parent' },
    { val: '__custom__', text: 'Custom path' },
  ];
  const { item: rootItem, select: rootSelect } = buildControl('Root', 'root', rootOptions, initial.root);

  const rootPathInput = document.createElement('input');
  rootPathInput.type = 'text';
  rootPathInput.name = 'rootPath';
  rootPathInput.placeholder = '/company/about-us';
  rootPathInput.value = initial.rootPath;
  rootPathInput.hidden = initial.root !== '__custom__';
  rootPathInput.className = 'card-list-config-path';
  rootItem.append(rootPathInput);

  const descriptionOptions = [
    { val: 'auto', text: 'Auto' },
    { val: 'true', text: 'Show' },
    { val: 'false', text: 'Hide' },
  ];
  const { item: descriptionItem, select: descriptionSelect } = buildControl(
    'Description',
    'description',
    descriptionOptions,
    initial.description,
  );

  controls.append(rootItem, descriptionItem);

  const actions = document.createElement('div');
  actions.className = 'card-list-config-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy link';

  actions.append(copyButton);
  panel.append(controls, actions);

  let widgetHref = '';

  const getState = () => ({
    root: rootSelect.value,
    rootPath: rootPathInput.value,
    description: descriptionSelect.value,
  });

  const update = async () => {
    rootPathInput.hidden = rootSelect.value !== '__custom__';
    const params = configToParams(getState());
    widgetHref = buildWidgetHref(params);

    const search = new URLSearchParams(window.location.search);
    search.delete('root');
    search.delete('description');
    if (params.root) search.set('root', params.root);
    if (params.description) search.set('description', params.description);
    const qs = search.toString();
    const nextUrl = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);

    const preview = widget.querySelector('.card-list-cards');
    await renderPreview(preview, {
      rootParam: params.root,
      descriptionParam: params.description,
      pagePath,
    });
  };

  rootSelect.addEventListener('change', () => { update(); });
  descriptionSelect.addEventListener('change', () => { update(); });
  rootPathInput.addEventListener('input', () => { update(); });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(widgetHref);
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1500);
    } catch {
      copyButton.textContent = 'Copy failed';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1500);
    }
  });

  return { panel, update };
}

/**
 * Decorates the card-list widget config UI.
 * @param {HTMLElement} widget
 */
export default async function decorateConfig(widget) {
  const pagePath = getReferrerPagePath();
  widget.classList.add('card-list-config-mode');

  const cardsContainer = widget.querySelector('.card-list-cards');
  if (!cardsContainer) return;

  const preview = document.createElement('section');
  preview.className = 'card-list-preview';
  preview.append(cardsContainer);
  widget.replaceChildren(preview);

  const { panel, update } = buildConfigPanel(widget, pagePath);
  widget.prepend(panel);
  await update();
}
