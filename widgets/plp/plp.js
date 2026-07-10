import {
  createOptimizedPicture, decorateBlock, loadBlock,
} from '../../scripts/aem.js';
import { normalizeIndexImageUrl, getLocale } from '../../scripts/scripts.js';

const FACETS = [
  { key: 'region', copyKey: 'region' },
  { key: 'track-gauge', copyKey: 'trackGauge' },
  { key: 'traction-horsepower', copyKey: 'tractionHorsepower' },
  { key: 'emissions-certifications', copyKey: 'emissionsCertification' },
  { key: 'axle-load', copyKey: 'axleLoad' },
  { key: 'traction-system', copyKey: 'tractionSystem' },
];

async function loadWidgetCopy(lang) {
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

function parseValues(raw) {
  return (raw || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function buildFacetCounts(items) {
  const counts = {};
  FACETS.forEach(({ key }) => {
    const map = {};
    items.forEach((item) => {
      parseValues(item[key]).forEach((v) => {
        map[v] = (map[v] || 0) + 1;
      });
    });
    counts[key] = map;
  });
  return counts;
}

function matchesFilters(item, selected) {
  return FACETS.every(({ key }) => {
    const active = selected[key];
    if (!active || active.size === 0) return true;
    const values = parseValues(item[key]);
    return values.some((v) => active.has(v));
  });
}

function buildCardRow(item) {
  const row = document.createElement('div');
  const image = normalizeIndexImageUrl(item.image);
  if (image) {
    const mediaCell = document.createElement('div');
    const picture = createOptimizedPicture(image, item.title || '', false, [{ width: '750' }]);
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
  row.append(bodyCell);
  return row;
}

function buildFiltersPanel(panel, counts, selected, onchange, copy) {
  panel.innerHTML = '';
  FACETS.forEach(({ key, copyKey }) => {
    const values = Object.keys(counts[key]);
    if (values.length === 0) return;
    values.sort();

    const group = document.createElement('fieldset');
    group.className = 'plp-facet';
    const legend = document.createElement('legend');
    legend.textContent = copy[copyKey] || copyKey;
    group.append(legend);

    values.forEach((val) => {
      const lbl = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = val;
      cb.checked = selected[key]?.has(val) || false;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!selected[key]) selected[key] = new Set();
          selected[key].add(val);
        } else {
          selected[key]?.delete(val);
        }
        onchange();
      });
      const count = counts[key][val] || 0;
      lbl.append(cb, ` ${val} (${count})`);
      group.append(lbl);
    });

    panel.append(group);
  });

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'plp-apply button';
  apply.textContent = copy.applyFilters || 'Apply Filters';
  apply.addEventListener('click', () => {
    const toggle = panel.closest('.plp-filters')?.querySelector('.plp-filters-toggle');
    toggle?.setAttribute('aria-expanded', 'false');
    document.body.dataset.scroll = '';
  });
  panel.append(apply);
}

async function renderCards(container, items) {
  const cardsBlock = document.createElement('div');
  cardsBlock.classList.add('cards');
  items.forEach((item) => cardsBlock.append(buildCardRow(item)));
  const wrapper = document.createElement('div');
  wrapper.append(cardsBlock);
  container.replaceChildren(wrapper);
  decorateBlock(cardsBlock);
  await loadBlock(cardsBlock);
}

export default async function decorate(widget) {
  const lang = getLocale();
  const [allItems, copy] = await Promise.all([loadIndex(lang), loadWidgetCopy(lang)]);
  const parentPath = window.location.pathname;
  const children = allItems
    .filter((item) => isDirectChild(item.path || '', parentPath))
    .map((item) => ({ ...item, path: item.path || '' }));

  if (children.length === 0) return;

  const selected = {};
  const panel = widget.querySelector('.plp-filters-panel');
  const results = widget.querySelector('.plp-results');
  const toggle = widget.querySelector('.plp-filters-toggle');

  toggle.querySelector('span').textContent = copy.filterBy || 'Filter By';

  const render = async () => {
    const filtered = children.filter((item) => matchesFilters(item, selected));
    const counts = buildFacetCounts(children);
    buildFiltersPanel(panel, counts, selected, render, copy);
    await renderCards(results, filtered);
  };

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    document.body.dataset.scroll = expanded ? '' : 'disabled';
  });

  await render();
}
