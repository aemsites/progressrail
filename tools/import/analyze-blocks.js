#!/usr/bin/env node
/**
 * analyze-blocks.js
 *
 * Scans the cleaned Progress Rail HTML pages, detects the AEM authoring
 * components on each page, and maps them to the target Edge Delivery (EDS)
 * blocks that the homepage transformation established.
 *
 * Purpose: discover which blocks the rest of the site needs before we build a
 * full transformer. It reports, per page and globally:
 *   - which known blocks each page uses,
 *   - which component signatures are NOT yet mapped to a block (so we know what
 *     still has to be designed).
 *
 * The known mappings were reverse-engineered from en/index.html:
 *
 *   SOURCE COMPONENT (cleaned DOM)              ->  EDS BLOCK
 *   -----------------------------------------------------------------
 *   div.teaser.teaser--hero                     ->  hero
 *   div.teaser.teaser--full-width               ->  banner
 *   div.teaser.teaser--checkerboard (±--right)  ->  columns  (one row each)
 *   div.list.list--content                      ->  cards
 *   div.secondary-navigation                    ->  jump-nav
 *   div.text / div.cmp-text (rte)               ->  (default content)
 *   div.title                                   ->  (default heading)
 *   div.button                                  ->  (default link)
 *   <title> + <meta name="description">         ->  metadata (every page)
 *   div.teaser.teaser--expired                  ->  (skipped: expired/hidden)
 *
 * Everything else is reported as UNMAPPED.
 *
 * Usage:
 *   node analyze-blocks.js <cleanedDir> [--out report.md]
 *
 * Requires: cheerio
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const SRC = path.resolve(process.argv[2] || ".");
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > -1 ? path.resolve(process.argv[outIdx + 1]) : null;

// Map a component's (type, variant) to a known block, or null if unmapped.
// variant is the most specific `type--variant` modifier (expired excluded).
function mapToBlock(type, variants) {
  const v = new Set(variants);
  if (type === "teaser") {
    if (v.has("expired")) return "(skip: expired teaser)";
    if (v.has("hero")) return "hero";
    if (v.has("full-width")) return "banner";
    if (v.has("checkerboard")) return "columns";
    if (v.has("tile")) return "cards (horizontal)";
    if (v.has("banner")) return "default + section-metadata (dark)";
    return "cards (horizontal)"; // bare/unknown teaser
  }
  if (type === "list") {
    if (v.has("content")) return "cards";
    if (v.has("links")) return "list (links)";
    if (v.has("detailed")) return "list (detailed)";
    if (v.has("simple-product")) return "list (product)";
    return null;
  }
  if (type === "carousel") return "carousel";
  if (type === "accordion") return "accordion";
  if (type === "tabs") return "tabs";
  if (type === "navigation") return "(skip: redirect)";
  if (type === "secondary-navigation" || type === "secondaryNavigation") return "jump-nav";
  if (type === "text" || type === "title" || type === "button") return "(default content)";
  // Structural wrappers we intentionally ignore.
  if (["container", "section-container", "responsivegrid", "experienceFragment"].includes(type))
    return "(structural)";
  return null;
}

// Component type -> CSS selector for its root instances in the cleaned DOM.
// Element-agnostic: component roots may be <div>, <section>, <nav>, etc.
const COMPONENT_SELECTORS = {
  teaser: ".teaser",
  list: ".list",
  "secondary-navigation": ".secondary-navigation",
  title: ".title",
  text: ".text",
  button: ".button",
  tabs: ".tabs",
  accordion: ".accordion",
  carousel: ".carousel",
  embed: ".embed",
  separator: ".separator",
  download: ".download",
  navigation: ".navigation",
  breadcrumb: ".breadcrumb",
  search: ".search",
};

function variantsOf($el, type) {
  const cls = ($el.attr("class") || "").split(/\s+/);
  const prefix = type + "--";
  return cls.filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
}

function analyzePage(html) {
  const $ = cheerio.load(html);
  const found = [];   // {type, variants, block}
  const seen = new Set();

  for (const [type, sel] of Object.entries(COMPONENT_SELECTORS)) {
    $(sel).each((_, el) => {
      const $el = $(el);
      // Skip nested duplicates (a .teaser inside a .teaser, etc.)
      if ($el.parents(sel).length) return;
      const variants = variantsOf($el, type);
      const block = mapToBlock(type, variants);
      found.push({ type, variants, block });
    });
  }
  // metadata is implicit on every page that has a description.
  const hasMeta = $('meta[name="description"]').length || $("title").length;
  return { found, hasMeta };
}

function findHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findHtml(full, acc);
    else if (e.isFile() && /\.html?$/i.test(e.name)) acc.push(full);
  }
  return acc;
}

function sigKey(type, variants) {
  const v = variants.filter((x) => x !== "expired").sort();
  return v.length ? `${type}.${type}--${v.join("+" + type + "--")}` : type;
}

function main() {
  const files = findHtml(SRC).sort();
  const global = new Map();   // signature -> {count, pages:Set, block}
  const perPage = [];

  for (const file of files) {
    const { found, hasMeta } = analyzePage(fs.readFileSync(file, "utf8"));
    const blocks = new Set();
    if (hasMeta) blocks.add("metadata");

    for (const { type, variants, block } of found) {
      const key = sigKey(type, variants);
      if (!global.has(key)) global.set(key, { count: 0, pages: new Set(), block });
      const g = global.get(key);
      g.count++;
      g.pages.add(file);
      if (block && !block.startsWith("(")) blocks.add(block);
    }
    perPage.push({ file: path.relative(SRC, file), blocks: [...blocks].sort() });
  }

  // Build report.
  const rows = [...global.entries()].sort((a, b) => b[1].count - a[1].count);
  const mapped = rows.filter(([, g]) => g.block && !g.block.startsWith("("));
  const skipped = rows.filter(([, g]) => g.block && g.block.startsWith("("));
  const unmapped = rows.filter(([, g]) => !g.block);

  let md = `# Block discovery report\n\n`;
  md += `Scanned **${files.length}** pages in \`${SRC}\`.\n\n`;

  md += `## Component signatures MAPPED to a block\n\n`;
  md += `| signature | -> block | instances | pages |\n|---|---|--:|--:|\n`;
  for (const [k, g] of mapped) md += `| \`${k}\` | ${g.block} | ${g.count} | ${g.pages.size} |\n`;

  md += `\n## Signatures NOT yet mapped (need a block design)\n\n`;
  md += `| signature | instances | pages |\n|---|--:|--:|\n`;
  for (const [k, g] of unmapped) md += `| \`${k}\` | ${g.count} | ${g.pages.size} |\n`;

  md += `\n## Intentionally skipped / structural\n\n`;
  md += `| signature | note | instances |\n|---|---|--:|\n`;
  for (const [k, g] of skipped) md += `| \`${k}\` | ${g.block} | ${g.count} |\n`;

  const out = md;
  if (OUT) fs.writeFileSync(OUT, out);
  // Console summary.
  console.log(`Scanned ${files.length} pages.`);
  console.log(`Mapped signatures:   ${mapped.length}`);
  console.log(`UNMAPPED signatures: ${unmapped.length}`);
  for (const [k, g] of unmapped) {
    const example = path.relative(SRC, [...g.pages][0]);
    console.log(`  - ${k}  (${g.count} instances, ${g.pages.size} pages)`);
    console.log(`      example: ${example}`);
  }
  if (OUT) console.log(`\nFull report -> ${OUT}`);
}

main();
