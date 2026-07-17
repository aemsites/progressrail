#!/usr/bin/env node
/**
 * Generates Sidekick block library files from authored content.
 * Usage: node tools/sidekick/generate-library.mjs [content-root]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = process.argv[2] || path.resolve(__dirname, '../../../content/aemsites/progressrail');
const outRoot = path.join(__dirname, 'library');

const blockConfig = {
  accordion: { title: 'Accordion', description: 'Expandable content sections with collapse/expand controls.' },
  cards: { title: 'Cards', description: 'Card grid for linked content with image, title, and description.' },
  columns: { title: 'Columns', description: 'Multi-column layout for text, media, and mixed content.' },
  gallery: { title: 'Gallery', description: 'Image gallery with slide navigation.' },
  hero: { title: 'Hero', description: 'Prominent page header with text and media, optionally as a carousel.' },
  'jump-nav': { title: 'Jump Nav', description: 'In-page anchor navigation with optional call-to-action.' },
  table: { title: 'Table', description: 'Structured tabular data.' },
  tabs: { title: 'Tabs', description: 'Tabbed content panels.' },
  video: { title: 'Video', description: 'Embedded video from YouTube or other sources.' },
};

/** Preferred examples from high-traffic / hub pages, in priority order. */
const preferredSources = {
  accordion: [
    { page: 'en/segments/locomotive.html', className: 'accordion' },
    { page: 'en/segments/freight-car.html', className: 'accordion' },
  ],
  cards: [
    { page: 'en/index.html', className: 'cards' },
    { page: 'en/services/supply-chain.html', className: 'cards center' },
    { page: 'en/company/about-us.html', className: 'cards horizontal' },
  ],
  columns: [
    { page: 'en/index.html', className: 'columns' },
    { page: 'en/segments.html', className: 'columns', variantKey: 'columns-segments', label: 'Columns (business segments)' },
    { page: 'en/company/leadership/john-newman.html', className: 'columns portrait', label: 'Columns (portrait)' },
  ],
  gallery: [
    { page: 'en/segments/rail-technology.html', className: 'gallery' },
    { page: 'en/company/about-us/emd100/1990s.html', className: 'gallery' },
  ],
  hero: [
    { page: 'en/segments/infrastructure.html', className: 'hero', preferFirst: true },
    { page: 'en/company/locations.html', className: 'hero carousel' },
  ],
  'jump-nav': [
    { page: 'en/index.html', className: 'jump-nav' },
    { page: 'en/segments.html', className: 'jump-nav' },
    { page: 'en/careers.html', className: 'jump-nav' },
  ],
  table: [
    { page: 'en/company/news.html', className: 'table' },
  ],
  tabs: [
    { page: 'en/segments/rail-technology.html', className: 'tabs' },
    { page: 'en/segments/locomotive.html', className: 'tabs' },
  ],
  video: [
    { page: 'en/index.html', className: 'video' },
    { page: 'en/careers.html', className: 'video' },
    { page: 'en/company.html', className: 'video' },
  ],
};

/** Fallback page priority when a curated source is unavailable. */
const pagePriority = [
  'en/index.html',
  'en/segments.html',
  'en/careers.html',
  'en/services.html',
  'en/company.html',
  'en/company/about-us.html',
  'en/company/locations.html',
  'en/segments/infrastructure.html',
  'en/segments/locomotive.html',
  'en/segments/rail-technology.html',
  'en/segments/freight-car.html',
];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.aem') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (ent.name.endsWith('.html')) files.push(p);
  }
  return files;
}

function extractDiv(html, start) {
  let depth = 0;
  let i = start;
  while (i < html.length) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close === -1) break;
    if (open !== -1 && open < close) {
      depth += 1;
      i = open + 4;
    } else {
      depth -= 1;
      i = close + 6;
      if (depth === 0) return html.slice(start, i);
    }
  }
  return null;
}

function getBlockClass(openTag) {
  const m = openTag.match(/class="([^"]+)"/);
  return m ? m[1] : '';
}

function findBlocks(html, classPrefix) {
  const results = [];
  const re = new RegExp(`<div class="${classPrefix}(?:\\s[^"]*)?">`, 'g');
  let match;
  while ((match = re.exec(html)) !== null) {
    const snippet = extractDiv(html, match.index);
    if (snippet) {
      results.push({
        className: getBlockClass(snippet.slice(0, snippet.indexOf('>') + 1)),
        snippet,
      });
    }
  }
  return results;
}

function displayName(className, label) {
  if (label) return label;
  const parts = className.split(/\s+/);
  const base = parts[0].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const variant = parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return variant ? `${base} (${variant.toLowerCase()})` : base;
}

function wrapSection(block, blockHtml, display, description, isFirst) {
  const parts = [];
  parts.push('      <div>');
  parts.push(`        <div class="library-metadata">\n          <div>\n            <div>name</div>\n            <div>${display}</div>\n          </div>`);
  if (isFirst && description) {
    parts.push(`          <div>\n            <div>description</div>\n            <div>${description}</div>\n          </div>`);
  }
  parts.push('        </div>');
  parts.push(`        ${blockHtml}`);
  parts.push('      </div>');
  return parts.join('\n');
}

function pageRank(relativePath) {
  const idx = pagePriority.indexOf(relativePath);
  return idx === -1 ? 0 : pagePriority.length - idx;
}

function fallbackScore(snippet, className, block, relativePath) {
  const len = snippet.length;
  if (len < 200) return -1;
  if (block === 'hero' && className.includes('carousel')) {
    return pageRank(relativePath) * 10000 + len;
  }
  if (len > 7000) return pageRank(relativePath) * 100;
  return pageRank(relativePath) * 10000 + Math.min(len, 5000);
}

function pickFromPage(html, { className, minLength = 200, preferFirst = false }) {
  const prefix = className.split(' ')[0];
  const matches = findBlocks(html, prefix).filter((b) => b.className === className);
  const eligible = matches.filter((b) => b.snippet.length >= minLength);
  if (!eligible.length) return null;
  if (preferFirst) return eligible[0];
  return eligible.sort((a, b) => b.snippet.length - a.snippet.length)[0];
}

function collectCuratedVariants(block) {
  const sources = preferredSources[block] || [];
  const variants = new Map();

  for (const source of sources) {
    const filePath = path.join(contentRoot, source.page);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const match = pickFromPage(html, source);
    if (!match) continue;
    const key = source.variantKey || source.className;
    if (!variants.has(key)) {
      variants.set(key, {
        className: source.className,
        snippet: match.snippet,
        file: source.page,
        key,
        label: source.label,
      });
    }
  }

  return variants;
}

function collectFallbackVariants(block, curatedKeys) {
  const variants = new Map();
  const files = walk(contentRoot);

  for (const file of files) {
    const relativePath = path.relative(contentRoot, file);
    const html = fs.readFileSync(file, 'utf8');

    for (const { className, snippet } of findBlocks(html, block)) {
      if (curatedKeys.has(className)) continue;
      const score = fallbackScore(snippet, className, block, relativePath);
      if (score < 0) continue;
      const existing = variants.get(className);
      if (!existing || score > existing.score) {
        variants.set(className, {
          className,
          snippet,
          score,
          file: relativePath,
          key: className,
        });
      }
    }
  }

  return variants;
}

if (!fs.existsSync(contentRoot)) {
  console.error(`Content root not found: ${contentRoot}`);
  process.exit(1);
}

if (!fs.existsSync(outRoot)) fs.mkdirSync(outRoot, { recursive: true });

for (const [block, variantMap] of Object.entries(blockConfig).map(([name]) => {
  const curated = collectCuratedVariants(name);
  const fallback = collectFallbackVariants(name, new Set(curated.keys()));
  const merged = new Map([...curated, ...fallback]);
  return [name, merged];
})) {
  const variantList = [...variantMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const sections = variantList.map((v, i) => wrapSection(
    block,
    v.snippet,
    displayName(v.className, v.label),
    blockConfig[block].description,
    i === 0,
  ));
  fs.writeFileSync(path.join(outRoot, `${block}.plain.html`), `${sections.join('\n')}\n`);
  console.log(`${blockConfig[block].title}: ${variantList.length} variant(s)`);
  variantList.forEach((v) => console.log(`  ${displayName(v.className, v.label)} <- ${v.file}`));
}

const libraryEntries = Object.entries(blockConfig)
  .map(([block, cfg]) => ({ name: cfg.title, path: `/tools/sidekick/library/${block}` }))
  .sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(path.join(__dirname, 'library.json'), `${JSON.stringify({
  total: libraryEntries.length,
  offset: 0,
  limit: libraryEntries.length,
  data: libraryEntries,
  columns: ['name', 'path'],
  ':type': 'sheet',
}, null, 2)}\n`);

console.log(`Updated library.json with ${libraryEntries.length} blocks`);
