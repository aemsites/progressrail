#!/usr/bin/env node
/**
 * transform-page.js  (prototype, validated on Fasteners.html)
 *
 * Transforms a cleaned Progress Rail page into the Edge Delivery (EDS) block
 * format, walking the top-level AEM components in document order.
 *
 * Block mappings (extended from the homepage reverse-engineering):
 *   teaser--hero           -> hero
 *   teaser--full-width     -> banner
 *   teaser--checkerboard   -> columns
 *   teaser--tile           -> cards (horizontal)   <-- NEW
 *   list--content          -> cards
 *   secondary-navigation   -> jump-nav
 *   title / texteditor      -> default headings & paragraphs
 *   teaser--expired        -> skipped
 *   <title> + description  -> metadata
 *
 * Consecutive components that map to the same card/column block are grouped
 * into a single block (so a run of tiles becomes one "cards (horizontal)").
 *
 * Output paths are ALWAYS lowercased / kebab-cased (AEM paths have capitals,
 * underscores and camelCase; EDS wants lowercase-hyphen paths). E.g.
 *   en/Segments/Infrastructure/Fasteners.html
 *     -> en/segments/infrastructure/fasteners.html
 *   en/Company/Community_Outreach/ChristmasForKids.html
 *     -> en/company/community-outreach/christmas-for-kids.html
 *
 * Usage:
 *   node transform-page.js <sourceRoot> <contentRoot>
 *     <sourceRoot>  cleaned site root (contains en.html, fr.html, en/, fr/),
 *                   e.g. .../downloads/www.progressrail.com/cleaned
 *     <contentRoot> EDS content repo to write into,
 *                   e.g. .../content/aemsites/progressrail
 *   Also exports { transformFile, kebabPath, runBatch } for programmatic use.
 * Requires cheerio.
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Lowercase + kebab a single path segment (handles _, spaces, camelCase, acronyms).
function kebabSeg(s) {
  const ext = /\.html?$/i.test(s) ? s.match(/\.html?$/i)[0].toLowerCase() : "";
  return (
    s
      .replace(/\.html?$/i, "")
      .replace(/[_\s]+/g, "-")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2") // camelCase boundary
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2") // ACRONYMWord boundary
      .toLowerCase()
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") + ext
  );
}
const kebabPath = (rel) => rel.split("/").map(kebabSeg).join("/");

// Current document — (re)assigned per file by transformFile().
let $;

const https = (u) => (u || "").replace(/^http:\/\//, "https://");

// Build an EDS <picture> from a single image URL.
function pic(src, alt = "") {
  src = https(src);
  return (
    `<picture><source srcset="${src}">` +
    `<source srcset="${src}" media="(min-width: 600px)">` +
    `<img src="${src}" alt="${alt}" loading="lazy"></picture>`
  );
}

// Text of a link/button with any material-icons glyph text removed.
function linkText($a) {
  const c = $a.clone();
  c.find(".material-icons").remove();
  return c.text().replace(/\s+/g, " ").trim();
}

function firstImg($el) {
  const img = $el.find("img").first();
  return { src: img.attr("src") || "", alt: img.attr("alt") || "" };
}

// Descriptive body paragraph of a teaser (skip dates / hidden fields).
// All meaningful body paragraphs of a teaser (role line, bio, etc.), in order,
// skipping datelines and empties. (Leadership teasers have several paragraphs.)
function teaserParas($t) {
  const scope = $t.find(".teaser__text-wrap").first();
  const where = scope.length ? scope : $t;
  const out = [], seen = new Set();
  where.find("p").each((_, p) => {
    const t = $(p).text().replace(/\s+/g, " ").trim();
    if (!t) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return;                 // iso date
    if (/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(t)) return;        // Month D, YYYY
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out;
}
const parasHtml = (paras) => paras.map((p) => `<p>${p}</p>`).join("");

function teaserCTA($t) {
  const a = $t.find("a.button, a.teaserDefaultButtonText, a").first();
  if (!a.length) return "";
  return { href: https(a.attr("href")), text: linkText(a) };
}

// ---- block builders (match the homepage output conventions) ----

function heroBlock($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const { src, alt } = firstImg($t);
  const cta = teaserCTA($t);
  const ctaHtml = cta && cta.text
    ? `<p><a href="${cta.href}"><strong>${cta.text}</strong></a></p>` : "";
  return `<div class="hero"><div><div>${pic(src, alt)}<h1><strong>${h}</strong></h1>${ctaHtml}</div></div></div>`;
}

function bannerBlock($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const { src, alt } = firstImg($t);
  const cta = teaserCTA($t);
  const ctaHtml = cta && cta.text
    ? `<p><a href="${cta.href}"><strong>${cta.text}</strong></a></p>` : "";
  return `<div class="banner"><div><div><h2><strong>${h}</strong></h2>${parasHtml(teaserParas($t))}${ctaHtml}</div><div>${pic(src, alt)}</div></div></div>`;
}

// One tile -> one card row (image cell + text cell).
function tileRow($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const { src, alt } = firstImg($t);
  const cta = teaserCTA($t);
  const parts = [`<h3><strong>${h}</strong></h3>`, parasHtml(teaserParas($t))];
  if (cta && cta.text) parts.push(`<p><a href="${cta.href}">${cta.text}</a></p>`);
  return `<div><div>${pic(src, alt)}</div><div>${parts.join("")}</div></div>`;
}

function cardsHorizontal(tiles) {
  return `<div class="cards horizontal">${tiles.map(tileRow).join("")}</div>`;
}

// list--content -> cards
function listCardsBlock($list) {
  const rows = [];
  $list.find("li.list__item").each((_, li) => {
    const $li = $(li);
    const name = $li.find(".list__name").text().trim();
    const desc = $li.find(".list__item-description, .list__description").first().text().trim()
      || $li.find("p").first().text().trim();
    const { src, alt } = firstImg($li);
    const a = $li.find("a.list__item-content, a").first();
    const href = https(a.attr("href"));
    const text = $li.find(".list__item-cta, .list__readmore").first().text().trim() || "Learn More";
    const parts = [`<h3><strong>${name}</strong></h3>`];
    if (desc) parts.push(`<p>${desc}</p>`);
    if (href) parts.push(`<p><a href="${href}">${text}</a></p>`);
    rows.push(`<div><div>${pic(src, alt)}</div><div>${parts.join("")}</div></div>`);
  });
  return `<div class="cards">${rows.join("")}</div>`;
}

function jumpNavBlock($nav) {
  const links = [];
  $nav.find(".desktop-view-secondary-nav nav a, nav a").each((_, a) => {
    const $a = $(a);
    links.push(`<li><a href="${https($a.attr("href"))}">${$a.text().trim()}</a></li>`);
    if (links.length >= 8) return false;
  });
  // de-dupe (mobile + desktop repeat the same links)
  const uniq = [...new Map(links.map((l) => [l, l])).keys()];
  const btn = $nav.find("a.button").first();
  const btnHtml = btn.length
    ? `<p><a href="${https(btn.attr("href"))}"><strong>${btn.text().trim()}</strong></a></p>` : "";
  return `<div class="jump-nav"><div><div><ul>${uniq.join("")}</ul>${btnHtml}</div></div></div>`;
}

// Clean an rte/.cmp-text box: <b>-><strong>, <i>-><em>, drop empty <p>, normalise.
function cleanRte($box) {
  if (!$box || !$box.length) return "";
  $box.find("b").each((_, b) => (b.tagName = "strong"));
  $box.find("i").each((_, i) => (i.tagName = "em"));
  $box.find("p").each((_, p) => {
    const $p = $(p);
    if ($p.text().replace(/ /g, " ").trim() === "" && !$p.find("img").length) $p.remove();
  });
  return ($box.html() || "")
    .replace(/&nbsp;| /g, " ")
    .replace(/>\s+</g, "><")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

// accordion -> two-column block: summary (left) / details (right) per item
function accordionBlock($acc) {
  const rows = [];
  $acc.find(".accordion__item, .cmp-accordion__item").each((_, it) => {
    const $it = $(it);
    const summary = $it.find(".accordion__heading, .cmp-accordion__title")
      .first().clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    const $body = $it.find(".accordion__body, .cmp-accordion__panel").first();
    const details = cleanRte($body.find(".cmp-text").first()) || cleanRte($body);
    rows.push(`<div><div>${summary}</div><div>${details}</div></div>`);
  });
  return `<div class="accordion">${rows.join("")}</div>`;
}

// Extract the fields of a single list item.
function listItem($it) {
  const name = $it.find(".list__name").first().text().replace(/\s+/g, " ").trim()
    || $it.find("a").first().text().replace(/\s+/g, " ").trim();
  const desc = $it.find(".list__item-description, .list__description").first()
    .text().replace(/\s+/g, " ").trim();
  const href = https($it.find("a[href]").first().attr("href") || "");
  const img = $it.find("img").attr("src") || "";
  return { name, desc, href, img };
}

// list--links/-simple/-detailed/-simple-product -> <div class="list <variant>">
// Cards model (image left / text right) when any item has an image; otherwise a
// single cell holding the list of links.
function listBlock($list, variant) {
  const items = $list.find("li.list__item, .list__item").toArray()
    .map((it) => listItem($(it)))
    .filter((x) => x.name || x.href || x.img); // drop empty items
  const hasImages = items.some((x) => x.img);

  if (hasImages) {
    const rows = items.map((x) => {
      const parts = [`<h3><strong>${x.name}</strong></h3>`];
      if (x.desc) parts.push(`<p>${x.desc}</p>`);
      if (x.href) parts.push(`<p><a href="${x.href}">Learn More</a></p>`);
      return `<div><div>${x.img ? pic(x.img, x.name) : ""}</div><div>${parts.join("")}</div></div>`;
    });
    return `<div class="list ${variant}">${rows.join("")}</div>`;
  }
  const lis = items.map((x) =>
    x.href ? `<li><a href="${x.href}">${x.name}</a></li>` : `<li>${x.name}</li>`
  );
  return `<div class="list ${variant}"><div><div><ul>${lis.join("")}</ul></div></div></div>`;
}

// tabs -> two-column block: tab label (left) / panel content (right) per tab
function tabsBlock($tabs) {
  const labels = $tabs.find(".cmp-tabs__tab, .tabs__tab, [role=tab]");
  const panels = $tabs.find(".cmp-tabs__tabpanel, .tabs__tabpanel, [role=tabpanel]");
  const rows = [];
  labels.each((i, t) => {
    const label = $(t).text().replace(/\s+/g, " ").trim();
    const $panel = $(panels[i]);
    const content = cleanRte($panel.find(".cmp-text").first()) || cleanRte($panel);
    rows.push(`<div><div>${label}</div><div>${content}</div></div>`);
  });
  return `<div class="tabs">${rows.join("")}</div>`;
}

// default content from a title / texteditor component
function defaultContent($el, type) {
  if (type === "title") {
    const hd = $el.find("h1,h2,h3,h4,h5,h6").first();
    if (!hd.length) return "";
    const txt = hd.text().trim();
    if (!txt) return "";
    return `<${hd[0].tagName}><strong>${txt}</strong></${hd[0].tagName}>`;
  }
  // texteditor / text -> its rte paragraphs
  const box = $el.find(".cmp-text").first();
  if (!box.length) return "";
  box.find("b").each((_, b) => (b.tagName = "strong"));
  box.find("i").each((_, i) => (i.tagName = "em"));
  box.find("p").each((_, p) => {
    const $p = $(p);
    if ($p.text().replace(/ /g, " ").trim() === "" && !$p.find("img").length) $p.remove();
  });
  let html = (box.html() || "").replace(/&nbsp;| /g, " ").replace(/>\s+</g, "><").replace(/[ \t\r\n]+/g, " ").trim();
  return html;
}

function metadataBlock() {
  let title = ($('meta[property="og:title"]').attr("content") || $("title").text() || "").trim();
  const bar = title.indexOf("|");
  if (bar > -1 && !$('meta[property="og:title"]').attr("content")) title = title.slice(bar + 1).trim();
  const desc = ($('meta[name="description"]').attr("content") || "").trim();
  return (
    `<div class="metadata">` +
    `<div><div><p>Title</p></div><div><p>${title}</p></div></div>` +
    `<div><div><p>Description</p></div><div><p>${desc}</p></div></div>` +
    `</div>`
  );
}

// text cell shared by banner / columns / carousel (heading + paragraphs + CTA)
function bannerCell(h, paras, cta) {
  const parts = [`<h2><strong>${h}</strong></h2>`, parasHtml(paras)];
  if (cta && cta.text) parts.push(`<p><a href="${cta.href}"><strong>${cta.text}</strong></a></p>`);
  return parts.join("");
}

// teaser--checkerboard run -> columns block.
// Source DOM is always text-then-image; teaser--right flips the image to the
// LEFT (text right). EDS renders cells left-to-right, so order them accordingly.
function columnsRow($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const cta = teaserCTA($t);
  const { src, alt } = firstImg($t);
  const textCell = `<div>${bannerCell(h, teaserParas($t), cta)}</div>`;
  const imgCell = `<div>${pic(src, alt)}</div>`;
  const right = ($t.attr("class") || "").split(/\s+/).includes("teaser--right");
  return right ? `<div>${imgCell}${textCell}</div>` : `<div>${textCell}${imgCell}</div>`;
}
const columnsBlock = (teasers) => `<div class="columns">${teasers.map(columnsRow).join("")}</div>`;

// carousel--promo -> carousel block; each slide laid out like a banner row
function carouselBlock($car) {
  const rows = [];
  $car.find(".cmp-carousel__item, .carousel__item").each((_, it) => {
    const $it = $(it);
    const h = $it.find(".teaserHeading, h1, h2, h3").first().text().trim();
    const cta = teaserCTA($it);
    const { src, alt } = firstImg($it);
    rows.push(`<div><div>${bannerCell(h, teaserParas($it), cta)}</div><div>${pic(src, alt)}</div></div>`);
  });
  return `<div class="carousel">${rows.join("")}</div>`;
}

// teaser--banner -> default content (heading/text/CTA) for a dedicated dark section
function bannerSectionContent($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const seen = new Set();
  const ps = [];
  $t.find(".teaser__text-wrap p, .teaser-blog-content").each((_, p) => {
    const t = $(p).text().replace(/\s+/g, " ").trim();
    if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !seen.has(t)) { seen.add(t); ps.push(t); }
  });
  const cta = teaserCTA($t);
  const parts = [`<h2>${h}</h2>`, ...ps.map((p) => `<p>${p}</p>`)];
  if (cta && cta.text) parts.push(`<p><a href="${cta.href}">${cta.text}</a></p>`);
  return parts.join("");
}
const SECTION_META_DARK =
  `<div class="section-metadata"><div><div>Style</div><div>dark</div></div></div>`;

// multimedia / media-youtube slider -> default content:
//   image slide -> a picture; video slide -> a plain YouTube link (EDS embeds it).
// Caption text of a multimedia slide (class is sometimes misspelled "mutlimedia").
function slideCaption($s) {
  return $s.find("[class*=imedia__description]").first().text().replace(/\s+/g, " ").trim();
}

// Classify a multimedia component's slides into images (with captions) + videos,
// then render: a multi-image gallery -> carousel block; a single image -> the
// picture plus its caption as default content; videos -> plain YouTube links.
function mediaContent($mm) {
  const slides = $mm.find(".multimedia__slide");
  const list = slides.length ? slides.toArray() : [$mm[0]];
  const images = [], videos = [];
  const seen = new Set();
  for (const s of list) {
    const $s = $(s);
    let ytid = $s.find("[data-ytvideoid]").attr("data-ytvideoid")
      || $s.find("[data-videoid]").attr("data-videoid");
    if (!ytid) {
      const thumb = $s.find("img").map((i, im) => $(im).attr("src")).get()
        .find((x) => /(?:youtube\.com\/vi|ytimg\.com\/vi)\//.test(x || ""));
      const m = thumb && thumb.match(/\/vi\/([^/]+)\//);
      if (m) ytid = m[1];
    }
    if (ytid) { if (!seen.has(ytid)) { seen.add(ytid); videos.push(ytid); } continue; }
    const src = $s.find("img").map((i, im) => $(im).attr("src")).get()
      .find((x) => x && !/[?&](cc-s|fmt=)/.test(x) && !/youtube|ytimg/.test(x));
    if (src && !seen.has(src)) {
      seen.add(src);
      images.push({ src, alt: $s.find("img").first().attr("alt") || "", cap: slideCaption($s) });
    }
  }

  const out = [];
  if (images.length > 1) {
    // gallery -> carousel: one slide per row (image + caption)
    const rows = images.map((im) =>
      `<div><div>${pic(im.src, im.alt)}${im.cap ? `<p>${im.cap}</p>` : ""}</div></div>`);
    out.push(`<div class="carousel">${rows.join("")}</div>`);
  } else if (images.length === 1) {
    const im = images[0];
    out.push(pic(im.src, im.alt));
    if (im.cap) out.push(`<p>${im.cap}</p>`);
  }
  for (const id of videos) {
    out.push(`<p><a href="https://www.youtube.com/watch?v=${id}">https://www.youtube.com/watch?v=${id}</a></p>`);
  }
  return out.join("");
}

// ---- walk top-level components in document order ----

const SELS = [".teaser", ".list", ".secondary-navigation", ".title", ".text",
  ".accordion", ".tabs", ".carousel", ".multimedia"];
const selJoin = SELS.join(",");

function typeOf($el) {
  const cls = ($el.attr("class") || "").split(/\s+/);
  if (cls.includes("teaser")) {
    if (cls.includes("teaser--expired")) return "skip";
    if (cls.some((c) => c === "teaser--hero")) return "hero";
    if (cls.some((c) => c === "teaser--full-width")) return "banner";
    if (cls.some((c) => c === "teaser--checkerboard")) return "columns";
    if (cls.some((c) => c === "teaser--tile")) return "tile";
    if (cls.some((c) => c === "teaser--banner")) return "banner-section";
    return "tile"; // bare/unknown teaser -> cards (horizontal), image left / text right
  }
  if (cls.includes("list")) {
    if (cls.includes("list--content")) return "list-cards";
    if (cls.includes("list--links")) return "list-links";        // covers links & links-simple
    if (cls.includes("list--detailed")) return "list-detailed";
    if (cls.includes("list--simple-product")) return "list-product";
    return "list?";
  }
  if (cls.includes("secondary-navigation")) return "jump-nav";
  if (cls.includes("title")) return "title";
  if (cls.includes("text")) return "text";
  if (cls.includes("accordion")) return "accordion";
  if (cls.includes("tabs")) return "tabs";
  if (cls.includes("carousel")) return "carousel";
  if (cls.includes("multimedia")) return "media";
  return "unknown";
}

// Build the EDS document string from the currently-loaded `$`.
// The image src of an image-only multimedia component (null if it's a video).
function mediaImageSrc($mm) {
  const hasVideo = $mm.find("[data-ytvideoid],[data-videoid]").length
    || $mm.find("img").toArray().some((im) => /youtube|ytimg/.test($(im).attr("src") || ""));
  if (hasVideo) return null;
  return $mm.find("img").map((i, im) => $(im).attr("src")).get()
    .find((x) => x && !/[?&](cc-s|fmt=)/.test(x) && !/youtube|ytimg/.test(x)) || null;
}

// AEM grid width (1-12) of a component, or 12 if unsized.
function gridWidth($el) {
  const $g = $el.is("[class*='aem-GridColumn--default--']") ? $el
    : $el.closest("[class*='aem-GridColumn--default--']");
  const m = ($g.attr("class") || "").match(/aem-GridColumn--default--(\d+)/);
  return m ? +m[1] : 12;
}

// An image-multimedia paired with an adjacent sized text becomes a columns block:
//   image side  = DOM order (image-first -> left, text-first -> right)
//   variant     = equal widths -> regular columns; unequal -> columns (narrow)
function columnsPairBlock($img, $text, imgFirst, variant) {
  const src = mediaImageSrc($img);
  const alt = $img.find("img").first().attr("alt") || "";
  const imgCell = `<div>${pic(src, alt)}</div>`;
  const textCell = `<div>${cleanRte($text.find(".cmp-text").first()) || cleanRte($text)}</div>`;
  const cls = variant === "narrow" ? "columns narrow" : "columns";
  const row = imgFirst ? `${imgCell}${textCell}` : `${textCell}${imgCell}`;
  return `<div class="${cls}"><div>${row}</div></div>`;
}

function transformDoc() {
const raw = [];
$(selJoin).each((_, el) => {
  const $el = $(el);
  if ($el.parents(selJoin).length) return; // top-level only
  raw.push({ $el, type: typeOf($el) });
});

// Pre-pass: a sized image-multimedia next to a sized text is a columns pair.
// (Full-width images stay as standalone default-content pictures.)
const comps = [];
const consumed = new Set();
for (let i = 0; i < raw.length; i++) {
  if (consumed.has(i)) continue;
  const c = raw[i];
  if (c.type === "media" && mediaImageSrc(c.$el)) {
    const wImg = gridWidth(c.$el);
    if (wImg < 12) {
      const next = raw[i + 1], prev = raw[i - 1];
      // image first -> image on the left
      if (next && next.type === "text" && gridWidth(next.$el) < 12 && !consumed.has(i + 1)) {
        const wT = gridWidth(next.$el);
        comps.push({ type: "columns-pair", $img: c.$el, $text: next.$el, imgFirst: true, variant: wImg === wT ? "regular" : "narrow" });
        consumed.add(i + 1);
        continue;
      }
      // text first -> image on the right (replace the already-pushed text)
      if (prev && prev.type === "text" && gridWidth(prev.$el) < 12 && comps.length && comps[comps.length - 1] === prev) {
        const wT = gridWidth(prev.$el);
        comps[comps.length - 1] = { type: "columns-pair", $img: c.$el, $text: prev.$el, imgFirst: false, variant: wImg === wT ? "regular" : "narrow" };
        continue;
      }
    }
  }
  comps.push(c);
}

// Sections: each is an array of html strings; main renders one <div> per section.
const sections = [[]];
const cur = () => sections[sections.length - 1];

// Group consecutive same-type components (tiles -> cards, checkerboard -> columns).
let run = { type: null, items: [] };
function flushRun() {
  if (!run.items.length) return;
  if (run.type === "tile") cur().push(cardsHorizontal(run.items));
  else if (run.type === "columns") cur().push(columnsBlock(run.items));
  run = { type: null, items: [] };
}

for (const item of comps) {
  const { $el, type } = item;
  if (type === "tile" || type === "columns") {
    if (run.type && run.type !== type) flushRun();
    run.type = type;
    run.items.push($el);
    continue;
  }
  flushRun();
  switch (type) {
    case "hero": cur().push(heroBlock($el)); break;
    case "banner": cur().push(bannerBlock($el)); break;
    case "carousel": cur().push(carouselBlock($el)); break;
    case "accordion": cur().push(accordionBlock($el)); break;
    case "tabs": cur().push(tabsBlock($el)); break;
    case "list-cards": cur().push(listCardsBlock($el)); break;
    case "list-links": cur().push(listBlock($el, "links")); break;
    case "list-detailed": cur().push(listBlock($el, "detailed")); break;
    case "list-product": cur().push(listBlock($el, "product")); break;
    case "jump-nav": cur().push(jumpNavBlock($el)); break;
    case "title": { const c = defaultContent($el, "title"); if (c) cur().push(c); break; }
    case "text": { const c = defaultContent($el, "text"); if (c) cur().push(c); break; }
    case "media": { const c = mediaContent($el); if (c) cur().push(c); break; }
    case "columns-pair": cur().push(columnsPairBlock(item.$img, item.$text, item.imgFirst, item.variant)); break;
    case "banner-section":
      // teaser--banner becomes its own dark section, then content resumes after.
      sections.push([bannerSectionContent($el), SECTION_META_DARK]);
      sections.push([]);
      break;
    case "skip": break;
    default: cur().push(`<!-- UNMAPPED component: ${type} -->`);
  }
}
flushRun();
cur().push(metadataBlock());

let mainInner = sections
  .filter((s) => s.length)
  .map((s) => `<div>${s.join("")}</div>`)
  .join("");

// --- General cleanup: strip empty rows from every block ---
// A row (direct child of a block) is "empty" when it has no visible text, no
// image with a real src, no <source srcset>, and no links.
function stripEmptyRows(html) {
  const $$ = cheerio.load(html, { decodeEntities: false });
  const BLOCKS = ["hero", "banner", "cards", "columns", "carousel", "accordion", "tabs", "list", "jump-nav", "metadata"];
  const isEmpty = ($el) => {
    if ($el.text().replace(/\s| /g, "").length) return false;
    if ($el.find("img").toArray().some((i) => ($$(i).attr("src") || "").trim())) return false;
    if ($el.find("source").toArray().some((s) => ($$(s).attr("srcset") || "").trim())) return false;
    if ($el.find("a").toArray().some((a) => ($$(a).attr("href") || "").trim())) return false;
    return true;
  };
  $$("body > *, body").each(() => {}); // noop to ensure body context
  BLOCKS.forEach((b) => {
    $$("." + b).each((_, blk) => {
      $$(blk).children("div").each((_, row) => {
        if (isEmpty($$(row))) $$(row).remove();
      });
    });
  });
  // cheerio wraps fragments in <html><body>; return inner body.
  return $$("body").html();
}
mainInner = stripEmptyRows(mainInner);

const doc =
  "\n<body>\n  <header></header>\n  <main>" +
  mainInner +
  "</main>\n  <footer></footer>\n</body>\n";

  return doc;
}

// Load one source file and return its transformed EDS document.
function transformFile(srcFile) {
  $ = cheerio.load(fs.readFileSync(srcFile, "utf8"), { decodeEntities: false });
  return transformDoc();
}

// ---------------------------------------------------------------------------
// Batch driver: transform a whole cleaned site into the content repo and
// record old -> new URL redirects.
//
//   node transform-page.js <sourceRoot> <contentRoot>
//
//   <sourceRoot>  cleaned site root containing en.html, fr.html, en/, fr/
//                 (e.g. .../downloads/www.progressrail.com/cleaned)
//   <contentRoot> the EDS content repo to write into
//                 (e.g. .../content/aemsites/progressrail)
//
// Section homepages (<lang>.html) become <lang>/index.html. Individual press
// releases are skipped (they use a dedicated transformer) but their existing
// redirects are preserved.
// ---------------------------------------------------------------------------

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc);
    else if (/\.html?$/i.test(e.name)) acc.push(f);
  }
  return acc;
}
const isPressRelease = (rel) => /\/Company\/News\/PressReleases\/[^/]+\.html$/i.test("/" + rel);

function runBatch(sourceRoot, contentRoot) {
  const SRC_ROOT = path.resolve(sourceRoot);
  const REPO = path.resolve(contentRoot);
  const redirects = [];
  let ok = 0, skipPR = 0, errs = [];

  const handle = (srcFile, isHome, lang) => {
    const rel = path.relative(SRC_ROOT, srcFile);
    if (!isHome && isPressRelease(rel)) { skipPR++; return; }
    try {
      const doc = transformFile(srcFile);
      const outRel = isHome ? path.join(lang, "index.html") : kebabPath(rel);
      const out = path.join(REPO, outRel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, doc);
      if (!isHome) {
        redirects.push({ Source: "/" + rel, Destination: "/" + kebabPath(rel).replace(/\.html?$/i, "") });
      }
      ok++;
    } catch (e) { errs.push(rel + " :: " + e.message); }
  };

  for (const lang of ["en", "fr"]) {
    const home = path.join(SRC_ROOT, lang + ".html");
    if (fs.existsSync(home)) handle(home, true, lang);
    const dir = path.join(SRC_ROOT, lang);
    if (fs.existsSync(dir)) for (const f of walk(dir)) handle(f, false, lang);
  }

  // Merge redirects with any existing entries (keep press-release/prior rows).
  const redirectsPath = path.join(REPO, "redirects.json");
  let sheet = { ":colWidths": [274, 241], ":sheetname": "data", ":type": "sheet" };
  if (fs.existsSync(redirectsPath)) sheet = JSON.parse(fs.readFileSync(redirectsPath, "utf8"));
  const existing = sheet.data || [];
  const seen = new Set(redirects.map((r) => r.Source));
  const kept = existing.filter((r) => !seen.has(r.Source));
  const merged = redirects.concat(kept).sort((a, b) => a.Source.localeCompare(b.Source));
  sheet.data = merged; sheet.total = merged.length; sheet.limit = merged.length; sheet.offset = 0;
  fs.writeFileSync(redirectsPath, JSON.stringify(sheet));

  console.log(`transformed: ${ok} | press-releases skipped: ${skipPR} | errors: ${errs.length}`);
  console.log(`redirects: ${redirects.length} new + ${kept.length} kept = ${merged.length} total`);
  errs.slice(0, 15).forEach((e) => console.log("  ERROR " + e));
}

if (require.main === module) {
  const [sourceRoot, contentRoot] = process.argv.slice(2);
  if (!sourceRoot || !contentRoot) {
    console.error("usage: node transform-page.js <sourceRoot> <contentRoot>");
    process.exit(1);
  }
  runBatch(sourceRoot, contentRoot);
}

module.exports = { transformFile, kebabPath, runBatch };
