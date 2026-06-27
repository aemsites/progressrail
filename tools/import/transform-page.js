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

// Match DA's serialization to keep diffs clean: literal non-breaking space, and
// &#x26; for ampersands inside attribute values (cheerio emits &nbsp; / &amp;).
function daSerialize(html) {
  // Drop every non-breaking space (entity or literal char) -> regular space.
  html = html.replace(/&nbsp;|&#xa0;|&#160;| /gi, " ");
  // Normalize the URL scheme to lowercase (source has stray "httpS://").
  html = html.replace(/\bhttp(s)?:\/\//gi, (_m, s) => (s ? "https" : "http") + "://");
  // Use &#x26; for ampersands inside attribute values (e.g. alt="News &#x26; Events").
  return html.replace(/="[^"]*"/g, (m) => m.replace(/&amp;/g, "&#x26;"));
}

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
    ? `<p><a href="${cta.href}"><em><strong>${cta.text}</strong></em></a></p>` : "";
  // two-cell model: text (heading + body + CTA) then image (matches current DA hero)
  return `<div class="hero"><div><div><h1>${h}</h1>${parasHtml(teaserParas($t))}${ctaHtml}</div><div>${pic(src, alt)}</div></div></div>`;
}

function bannerBlock($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const { src, alt } = firstImg($t);
  const cta = teaserCTA($t);
  const ctaHtml = cta && cta.text
    ? `<p><a href="${cta.href}"><em><strong>${cta.text}</strong></em></a></p>` : "";
  // teaser--full-width is a hero (DA reclassified banner -> hero); keep h2 + body
  return `<div class="hero"><div><div><h2>${h}</h2>${parasHtml(teaserParas($t))}${ctaHtml}</div><div>${pic(src, alt)}</div></div></div>`;
}

// One tile -> one card row (image cell + text cell).
function tileRow($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const { src, alt } = firstImg($t);
  const cta = teaserCTA($t);
  const parts = [`<h3>${h}</h3>`, parasHtml(teaserParas($t))];
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
    if (!name && !src && !href) return; // skip empty placeholder items
    const text = $li.find(".list__item-cta, .list__readmore").first().text().trim() || "Learn More";
    const parts = [`<h3>${name}</h3>`];
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
      const parts = [`<h3>${x.name}</h3>`];
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
    return `<${hd[0].tagName}>${txt}</${hd[0].tagName}>`;
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

// "progress-rail" tag blob (Progress Rail^Category^Facet^Value | ...) -> one
// metadata row per facet, multi-values comma-joined. Entity-encoded values
// (e.g. "&gt;30 mT") are kept as-is, which is valid inside <p> text.
function progressRailFacetRows() {
  const raw = $('meta[name="progress-rail"]').attr("content") || "";
  if (!raw) return "";
  const order = [], vals = {};
  for (const entry of raw.split("|")) {
    const parts = entry.split("^").map((x) => x.trim()).filter(Boolean);
    if (parts.length < 4) continue;
    const facet = parts[2], value = parts.slice(3).join("^");
    if (!vals[facet]) { vals[facet] = []; order.push(facet); }
    if (!vals[facet].includes(value)) vals[facet].push(value);
  }
  return order.map((f) =>
    `<div><div><p>${f}</p></div><div><p>${vals[f].join(", ")}</p></div></div>`).join("");
}

function metadataBlock() {
  // Prefer <title> over og:title, and drop the "ProgressRail | " site-name prefix.
  let title = ($("title").text() || $('meta[property="og:title"]').attr("content") || "").trim();
  const bar = title.indexOf("|");
  if (bar > -1) title = title.slice(bar + 1).trim();
  // Prefer og:description; fall back to the (often longer) name=description.
  const desc = ($('meta[property="og:description"]').attr("content")
    || $('meta[name="description"]').attr("content") || "").trim();
  // og:image -> Image metadata (the curated social/preview image).
  const ogImage = ($('meta[property="og:image"]').attr("content") || "").trim();
  const imageRow = ogImage
    ? `<div><div><p>Image</p></div><div>${pic(ogImage, title)}</div></div>` : "";
  return (
    `<div class="metadata">` +
    `<div><div><p>Title</p></div><div><p>${title}</p></div></div>` +
    `<div><div><p>Description</p></div><div><p>${desc}</p></div></div>` +
    imageRow +
    progressRailFacetRows() +
    `</div>`
  );
}

// text cell shared by banner / columns / carousel (heading + paragraphs + CTA)
function bannerCell(h, paras, cta) {
  const parts = [`<h2>${h}</h2>`, parasHtml(paras)];
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

// teaser--banner -> columns block (heading+text | CTA) for a dedicated dark section
function bannerSectionContent($t) {
  const h = $t.find(".teaserHeading").first().text().trim();
  const seen = new Set();
  const ps = [];
  $t.find(".teaser__text-wrap p, .teaser-blog-content").each((_, p) => {
    const t = $(p).text().replace(/\s+/g, " ").trim();
    if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !seen.has(t)) { seen.add(t); ps.push(t); }
  });
  const cta = teaserCTA($t);
  const textCol = [`<h2>${h}</h2>`, ...ps.map((p) => `<p>${p}</p>`)].join("");
  if (cta && cta.text) {
    return `<div class="columns"><div><div>${textCol}</div><div><p><a href="${cta.href}">${cta.text}</a></p></div></div></div>`;
  }
  return textCol;
}

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
    // image gallery -> carousel (slides); carousel--promo stays a plain carousel
    out.push(`<div class="carousel slides">${rows.join("")}</div>`);
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
//   variant     = equal widths -> regular columns; unequal -> columns (portrait)
function columnsPairBlock($img, $text, imgFirst, variant) {
  const src = mediaImageSrc($img);
  const alt = $img.find("img").first().attr("alt") || "";
  const imgCell = `<div>${pic(src, alt)}</div>`;
  const textCell = `<div>${cleanRte($text.find(".cmp-text").first()) || cleanRte($text)}</div>`;
  const cls = variant === "portrait" ? "columns portrait" : "columns";
  const row = imgFirst ? `${imgCell}${textCell}` : `${textCell}${imgCell}`;
  return `<div class="${cls}"><div>${row}</div></div>`;
}

// ---- Fragments ----------------------------------------------------------
// Reusable blocks that repeat across many pages are extracted to a single
// fragment page and replaced inline with a plain link to it. Add rules here
// to identify more fragments/widgets across the site.
const listTargets = ($L) => $L.find("li.list__item")
  .map((i, it) => $(it).find("#linkPagePath,#anchorValue").attr("value")
    || $(it).find("a[href]").attr("href") || "").get().filter(Boolean);

const FRAGMENT_HOST = "https://main--progressrail--aemsites.aem.page";
const FRAGMENT_RULES = [
  {
    // Fragment: generated, language-aware page; inline reference replaced by a link.
    name: "leadership-execs",
    path: (lang) => `${lang}/company/leadership/fragments/leadership`,
    match(item) {
      if (item.type !== "list-cards") return false;
      const t = listTargets(item.$el);
      return t.length >= 3 && t.every((x) => /\/Leadership\/[^/]+\.html$/i.test(x));
    },
    build(item) { return listCardsBlock(item.$el); },
  },
  {
    // Widget: external page (not generated here); just link to its fixed URL.
    name: "press-releases",
    widget: "https://main--progressrail--aemsites.aem.page/widgets/press-releases/press-releases.html",
    match(item) {
      if (!/^list-/.test(item.type)) return false;
      const t = listTargets(item.$el);
      return t.length >= 3 && t.every((x) => /\/PressReleases\/[^/]+\.html$/i.test(x));
    },
  },
  {
    // Widget: a "list children" component that renders populated facet filters is
    // a product-listing page (PLP). Identified by rendered .filter__name options
    // (the inert .list__filter-col wrapper is present on every list, so isn't the
    // signal). Links to the PLP widget; no root param needed.
    name: "plp",
    widget: "https://main--progressrail--aemsites.aem.page/widgets/plp/plp.html",
    match(item) {
      if (!/^list/.test(item.type || "")) return false;
      const $L = item.$el;
      if (($L.find("#listFormValue").attr("value") || "").toLowerCase() !== "children") return false;
      return $L.find(".filter__name").length > 0;
    },
  },
  {
    // Widget: any AEM "list children" component -> the card-list widget, with a
    // stable, language-relative `root` query param:
    //   (no param)        -> children of self
    //   ?root=parent      -> children of the parent (siblings)
    //   ?root=/seg/...     -> children of an explicit page (relative to lang root)
    //   ?root=unresolved   -> couldn't infer from the crawl (revisit later)
    name: "card-list",
    match(item) { return cardListWidgetUrl(item) !== null; },
    widgetUrl(item) { return cardListWidgetUrl(item); },
  },
];
const CARD_LIST_WIDGET = "https://main--progressrail--aemsites.aem.page/widgets/card-list/card-list.html";

// For an AEM list with listFormValue=children, work out the widget URL + root
// param. Returns null if the list isn't a "children" list (leave it inline).
function cardListWidgetUrl(item) {
  if (!/^list/.test(item.type || "")) return null;
  const $L = item.$el;
  if (($L.find("#listFormValue").attr("value") || "").toLowerCase() !== "children") return null;
  const dir = (p) => p.replace(/\/[^/]*$/, "");
  const hrefs = $L.find("li.list__item a[href]").map((i, a) => $(a).attr("href") || "").get()
    .filter((x) => /^\/(en|fr)\/[^"#?]+\.html?$/i.test(x));
  let root; // undefined => self (no param)
  if (!hrefs.length) root = "unresolved";
  else {
    const dirs = [...new Set(hrefs.map(dir))];
    const itemdir = dirs.length === 1 ? dirs[0] : null;     // null => mixed/curated
    if (!itemdir) root = "unresolved";
    else if (itemdir === currentPageAbs.replace(/\.html?$/i, "")) root = undefined;   // self
    else if (itemdir === dir(currentPageAbs)) root = "parent";                         // siblings
    else root = ("/" + kebabPath(itemdir.replace(/^\//, ""))).replace(/^\/(en|fr)/, ""); // explicit
  }
  const params = [];
  if (root !== undefined) params.push(`root=${root}`);
  // showDescription=false -> title-only navigation tiles (default is cards-with-text).
  if (($L.find("#showDescription").attr("value") || "").toLowerCase() === "false") params.push("description=false");
  return params.length ? `${CARD_LIST_WIDGET}?${params.join("&")}` : CARD_LIST_WIDGET;
}
let currentLang = "en";       // set per file by transformFile()
let currentPageAbs = "/en/index.html"; // source path of the page being transformed
// Captured across the whole batch (module-level so runBatch can write the pages).
const fragments = {};         // outPath -> { content, url, name }
const fragmentUsage = {};     // url -> number of pages that referenced it

function matchFragment(item) {
  const rule = FRAGMENT_RULES.find((r) => r.match(item));
  if (!rule) return null;
  if (rule.widgetUrl) {                         // widget with a dynamically-built URL
    const url = rule.widgetUrl(item);
    if (!url) return null;
    fragmentUsage[url] = (fragmentUsage[url] || 0) + 1;
    return `<p><a href="${url}">${url}</a></p>`;
  }
  if (rule.widget) {
    fragmentUsage[rule.widget] = (fragmentUsage[rule.widget] || 0) + 1;
    return `<p><a href="${rule.widget}">${rule.widget}</a></p>`;
  }
  const rel = rule.path(currentLang);
  const url = `${FRAGMENT_HOST}/${rel}`;
  const outPath = `${rel}.html`;
  if (!fragments[outPath]) fragments[outPath] = { content: rule.build(item), url, name: rule.name };
  fragmentUsage[url] = (fragmentUsage[url] || 0) + 1;
  return `<p><a href="${url}">${url}</a></p>`;
}

// Pre-pass: normalize AEM media / JS embeds anywhere in the document so they
// don't leak raw widget markup when nested inside another block (tabs, accordion,
// columns ...), where the main walker never reaches them.
function cleanEmbeds() {
  // Stray clientlib stylesheets AEM injects alongside media widgets.
  $('link[rel="stylesheet"]').remove();
  // Cookie-consent placeholders are not real content.
  $(".cookie-warning, .multimedia-cookie-warning").remove();
  // jsComponent: an <iframe> stuffed into a data-js attribute -> a plain link.
  $(".jsComponent").each((_, el) => {
    const $c = $(el);
    const dj = $c.find("[data-js]").attr("data-js") || $c.attr("data-js") || "";
    const m = dj.match(/src\s*=\s*(?:&quot;|&#x22;|"|')(.*?)(?:&quot;|&#x22;|"|'|>)/i);
    if (m && m[1].trim()) {
      const url = m[1].replace(/&amp;/g, "&").trim();
      $c.replaceWith(`<p><a href="${url}">${url}</a></p>`);
    } else $c.remove();
  });
  // experienceFragment + AEM grid scaffolding nested in a block panel is pure
  // layout -> unwrap to its inner content. (Scoped to accordion/tabs panels so
  // the top-level grid-width detection used by the columns pre-pass is untouched.)
  $(".experiencefragment").toArray().forEach((el) => {
    const $xf = $(el);
    if (!$xf.closest(".accordion, .cmp-accordion, .tabs, .cmp-tabs").length) return;
    $xf.find(".aem-Grid, .aem-GridColumn, .xf-content-height, .container, .row, [class^='col-'], [class*=' col-']")
      .toArray().forEach((w) => { const $w = $(w); $w.replaceWith($w.contents()); });
    $xf.replaceWith($xf.contents());
  });
  // Teasers nested inside another block (e.g. a tab/accordion panel) can't render
  // as their own block in a cell -> flatten to heading + text + media + CTA.
  // (Top-level teasers are handled by the main walker.)
  $(".teaser").each((_, el) => {
    const $t = $(el);
    if (!$t.parents(selJoin).length) return;
    const parts = [];
    const h = $t.find(".teaserHeading").first().text().trim();
    if (h) parts.push(`<h3>${h}</h3>`);
    teaserParas($t).forEach((p) => parts.push(`<p>${p}</p>`));
    const yt = $t.find("[data-ytvideoid]").attr("data-ytvideoid")
      || $t.find("[data-videoid]").attr("data-videoid");
    if (yt) parts.push(`<p><a href="https://www.youtube.com/watch?v=${yt}">https://www.youtube.com/watch?v=${yt}</a></p>`);
    else { const { src, alt } = firstImg($t); if (src) parts.push(pic(src, alt)); }
    const cta = teaserCTA($t);
    if (cta && cta.text) parts.push(`<p><a href="${cta.href}">${cta.text}</a></p>`);
    $t.replaceWith(parts.join(""));
  });
  // Multimedia nested inside another block -> its mediaContent rendering
  // (video-only => YouTube link). Top-level multimedia is left for the walker.
  $(".multimedia").each((_, el) => {
    const $mm = $(el);
    if (!$mm.parents(selJoin).length) return;
    const repl = mediaContent($mm) || "";
    const $wrap = $mm.closest(".media-youtube");
    ($wrap.length ? $wrap : $mm).replaceWith(repl);
  });
}

function transformDoc() {
cleanEmbeds();

// In-page anchors referenced by a jump-nav: each becomes a new section whose
// section-metadata carries an `id`, so the jump-nav links resolve in EDS.
const navIds = new Set();
$(".secondary-navigation a[href^='#'], .jump-nav a[href^='#']").each((_, a) => {
  const id = (($(a).attr("href") || "").slice(1)).trim();
  if (id && id !== "top" && id !== "mainContent") navIds.add(id);
});
const anchorOf = new Map(); // top-level component element -> id that starts its section
if (navIds.size) {
  let pending = null;
  $("*").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    if (id && navIds.has(id)) { pending = id; return; }    // an anchor marker
    if (pending && $el.is(selJoin) && !$el.parents(selJoin).length) {
      anchorOf.set(el, pending); pending = null;             // the next top-level component
    }
  });
}

const raw = [];
$(selJoin).each((_, el) => {
  const $el = $(el);
  if ($el.parents(selJoin).length) return; // top-level only
  raw.push({ $el, type: typeOf($el), anchorId: anchorOf.get(el) });
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
        comps.push({ type: "columns-pair", $img: c.$el, $text: next.$el, imgFirst: true, variant: wImg === wT ? "regular" : "portrait", anchorId: c.anchorId });
        consumed.add(i + 1);
        continue;
      }
      // text first -> image on the right (replace the already-pushed text)
      if (prev && prev.type === "text" && gridWidth(prev.$el) < 12 && comps.length && comps[comps.length - 1] === prev) {
        const wT = gridWidth(prev.$el);
        comps[comps.length - 1] = { type: "columns-pair", $img: c.$el, $text: prev.$el, imgFirst: false, variant: wImg === wT ? "regular" : "portrait", anchorId: prev.anchorId };
        continue;
      }
    }
  }
  comps.push(c);
}

// Sections: each is { items: html[], style, id }; main renders one <div> per section.
const newSection = () => ({ items: [], style: null, id: null });
const sections = [newSection()];
const cur = () => sections[sections.length - 1];
let heroSectioned = false; // section break after the first hero

// Group consecutive same-type components (tiles -> cards, checkerboard -> columns).
let run = { type: null, items: [] };
function flushRun() {
  if (!run.items.length) return;
  if (run.type === "tile") cur().items.push(cardsHorizontal(run.items));
  else if (run.type === "columns") cur().items.push(columnsBlock(run.items));
  run = { type: null, items: [] };
}

for (const item of comps) {
  const { $el, type } = item;
  // An in-page anchor referenced by the jump-nav starts a new section carrying its id.
  if (item.anchorId) {
    flushRun();
    if (cur().items.length || cur().id) sections.push(newSection());
    cur().id = item.anchorId;
  }
  if (type === "tile" || type === "columns") {
    if (run.type && run.type !== type) flushRun();
    run.type = type;
    run.items.push($el);
    continue;
  }
  flushRun();
  const fragLink = matchFragment(item);
  if (fragLink) { cur().items.push(fragLink); continue; }
  switch (type) {
    case "hero":
    case "banner": // teaser--full-width also renders as a hero block
      cur().items.push(type === "hero" ? heroBlock($el) : bannerBlock($el));
      if (!heroSectioned) { heroSectioned = true; sections.push(newSection()); } // break after first hero
      break;
    case "carousel": cur().items.push(carouselBlock($el)); break;
    case "accordion": cur().items.push(accordionBlock($el)); break;
    case "tabs": cur().items.push(tabsBlock($el)); break;
    case "list-cards": cur().items.push(listCardsBlock($el)); break;
    case "list-links": cur().items.push(listBlock($el, "links")); break;
    case "list-detailed": cur().items.push(listBlock($el, "detailed")); break;
    case "list-product": cur().items.push(listBlock($el, "product")); break;
    case "jump-nav": // jump-nav always stands alone in its own section
      if (cur().items.length || cur().id || cur().style) sections.push(newSection());
      cur().items.push(jumpNavBlock($el));
      sections.push(newSection());
      break;
    case "title": { const c = defaultContent($el, "title"); if (c) cur().items.push(c); break; }
    case "text": { const c = defaultContent($el, "text"); if (c) cur().items.push(c); break; }
    case "media": { const c = mediaContent($el); if (c) cur().items.push(c); break; }
    case "columns-pair": cur().items.push(columnsPairBlock(item.$img, item.$text, item.imgFirst, item.variant)); break;
    case "banner-section":
      // teaser--banner becomes its own dark section, then content resumes after.
      { const s = newSection(); s.items.push(bannerSectionContent($el)); s.style = "dark"; sections.push(s); }
      sections.push(newSection());
      break;
    case "skip": break;
    default: cur().items.push(`<!-- UNMAPPED component: ${type} -->`);
  }
}
flushRun();
cur().items.push(metadataBlock());

// section-metadata combining any Style + id this section carries.
function sectionMeta(s) {
  const rows = [];
  if (s.style) rows.push(`<div><div>Style</div><div>${s.style}</div></div>`);
  if (s.id) rows.push(`<div><div>id</div><div>${s.id}</div></div>`);
  return rows.length ? `<div class="section-metadata">${rows.join("")}</div>` : "";
}
let mainInner = sections
  .filter((s) => s.items.length || s.id || s.style)
  .map((s) => `<div>${s.items.join("")}${sectionMeta(s)}</div>`)
  .join("");

// --- General cleanup: strip empty rows from every block ---
// A row (direct child of a block) is "empty" when it has no visible text, no
// image with a real src, no <source srcset>, and no links.
function stripEmptyRows(html) {
  const $$ = cheerio.load(html, { decodeEntities: false });
  const BLOCKS = ["hero", "banner", "cards", "columns", "carousel", "accordion", "tabs", "list", "jump-nav", "metadata", "section-metadata"];
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
  // A block cell holding loose text / inline content must wrap it in a <p>
  // (EDS/DA convention: cell text is never bare). Cells already carrying a
  // block-level child (p, heading, list, picture, ...) are left untouched.
  const BLOCK_CHILD = "p,h1,h2,h3,h4,h5,h6,ul,ol,table,picture,img,figure,blockquote,div";
  BLOCKS.forEach((b) => {
    $$("." + b).each((_, blk) => {
      $$(blk).children("div").each((_, row) => {
        $$(row).children("div").each((_, cell) => {
          const $c = $$(cell);
          if (!$c.text().replace(/\s| /g, "").length && !$c.children("img,picture").length) return;
          if ($c.children(BLOCK_CHILD).length) return; // already block-wrapped
          $c.html(`<p>${$c.html()}</p>`);
        });
      });
    });
  });
  // cheerio wraps fragments in <html><body>; return inner body.
  // DA strips redundant <strong> inside headings — match that (unwrap them).
  // unwrap <strong> inside headings (DA strips it) — snapshot to survive mutation
  $$("h1,h2,h3,h4,h5,h6").find("strong").toArray().forEach((s) => { const $s = $$(s); $s.replaceWith($s.contents()); });
  // presentational <span class="..."> shouldn't pass through to EDS content — unwrap them
  $$("span[class]").toArray().forEach((s) => { const $s = $$(s); $s.replaceWith($s.contents()); });
  $$("a[target]").removeAttr("target"); // drop target attributes from links
  // Remove "back to top" links (EDS auto-blocks #top anchors). Leave the jump-nav.
  $$("a").toArray().forEach((a) => {
    const $a = $$(a);
    if ($a.closest(".jump-nav").length) return;
    const href = ($a.attr("href") || "").trim().toLowerCase();
    const txt = $a.text().replace(/\s+/g, " ").trim().toLowerCase();
    if (href !== "#top" && txt !== "back to top") return;
    const $w = $a.closest("h1,h2,h3,h4,h5,h6,p");
    if ($w.length && $w.text().replace(/\s+/g, " ").trim().toLowerCase() === txt) $w.remove();
    else $a.remove();
  });
  return $$("body").html();
}
mainInner = stripEmptyRows(mainInner);

const doc =
  "\n<body>\n  <header></header>\n  <main>" +
  mainInner +
  "</main>\n  <footer></footer>\n</body>\n";

  return daSerialize(doc);
}

// Load one source file and return its transformed EDS document.
function transformFile(srcFile, lang) {
  currentLang = lang || (/^\/?fr(\/|$|\.)/.test(srcFile.split(/[\\/]/).slice(-3).join("/")) ? "fr" : "en");
  const mm = srcFile.replace(/\\/g, "/").match(/\/((?:en|fr)\/.*\.html?)$/i);
  currentPageAbs = mm ? "/" + mm[1] : `/${currentLang}/index.html`;
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
  let ok = 0, skipPR = 0, skipProtected = 0, skipExcluded = 0, errs = [];

  // Authored EDS files (homepage, nav/footer fragments, search) — never
  // generated from the crawl. Excluded by default; pass --include-special to override.
  const EXCLUDE_RE = /^(?:en|fr)\/(?:index|nav|footer|search)\.html$/;
  const includeSpecial = process.argv.includes("--include-special");

  // Pages a human edited in DA (from reconcile.js) — never overwrite these.
  let protectedSet = new Set();
  if (process.argv.includes("--skip-protected")) {
    const pf = path.join(__dirname, "protected-files.json"); // written by reconcile.js, beside the scripts
    if (fs.existsSync(pf)) protectedSet = new Set(JSON.parse(fs.readFileSync(pf, "utf8")));
  }

  const handle = (srcFile, isHome, lang) => {
    const rel = path.relative(SRC_ROOT, srcFile);
    if (!isHome && isPressRelease(rel)) { skipPR++; return; }
    try {
      const outRel = isHome ? path.join(lang, "index.html") : kebabPath(rel);
      const outKey = outRel.replace(/\\/g, "/");
      if (!includeSpecial && EXCLUDE_RE.test(outKey)) { skipExcluded++; return; } // homepage/nav/footer
      if (!isHome) {
        redirects.push({ Source: "/" + rel, Destination: "/" + kebabPath(rel).replace(/\.html?$/i, "") });
      }
      if (protectedSet.has(outRel)) { skipProtected++; return; } // keep the human edit
      const doc = transformFile(srcFile, lang);
      const out = path.join(REPO, outRel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, doc);
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

  // Write the fragment pages captured during transformation.
  for (const [outPath, frag] of Object.entries(fragments)) {
    const out = path.join(REPO, outPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, daSerialize(`\n<body>\n  <header></header>\n  <main><div>${frag.content}</div></main>\n  <footer></footer>\n</body>\n`));
    console.log(`fragment ${frag.name}: ${outPath} (referenced on ${fragmentUsage[frag.url]} pages)`);
  }
  for (const rule of FRAGMENT_RULES) {
    if (rule.widget && fragmentUsage[rule.widget]) {
      console.log(`widget ${rule.name}: ${rule.widget} (referenced on ${fragmentUsage[rule.widget]} pages)`);
    }
  }

  console.log(`transformed: ${ok} | press-releases skipped: ${skipPR} | protected skipped: ${skipProtected} | special skipped: ${skipExcluded} | errors: ${errs.length}`);
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
