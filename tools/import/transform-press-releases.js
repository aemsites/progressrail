#!/usr/bin/env node
/**
 * transform-press-releases.js
 *
 * Transforms full Progress Rail press-release pages into the stripped AEM
 * document-authoring format:
 *
 *   <body>
 *     <header></header>
 *     <main><div><h1><strong>TITLE</strong></h1>...body paragraphs...</div></main>
 *     <footer></footer>
 *   </body>
 *
 * Content rules (derived from the hand-made example):
 *   - Title comes from <title> ("ProgressRail | Real Title") and is wrapped in
 *     <h1><strong>…</strong></h1>.
 *   - Body comes from the single <div class="cmp-text"> block.
 *   - <b> -> <strong> and <i> -> <em>.
 *   - Empty paragraphs (<p>&nbsp;</p>, <p></p>) are dropped.
 *   - &nbsp; is normalised to a regular space.
 *
 * Filename:  <year>-<slug>.html
 *   - year : 4-digit year from the dateline in the body.
 *   - slug : first few words of the title, kebab-cased, trailing stop-words
 *            trimmed, so names stay short.
 *
 * Usage:
 *   node transform-press-releases.js <srcDir> <outDir> [--map mapping.csv]
 *
 * Reads every *.html under srcDir, writes <year>-<slug>.html into outDir.
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const SRC = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const mapIdx = process.argv.indexOf("--map");
const MAP = mapIdx > -1 ? path.resolve(process.argv[mapIdx + 1]) : null;

const STOPWORDS = new Set([
  "to", "and", "of", "the", "for", "a", "an", "with", "in", "on", "at",
  "et", "de", "la", "le", "les", "des", "du", "pour", "un", "une", "au",
]);
const MAX_SLUG_WORDS = 6;     // hard ceiling on words considered
const SLUG_CHAR_BUDGET = 34;  // keep names short

function slugify(title) {
  const words = title
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae") // expand ligatures to ASCII
    .replace(/[‘’']/g, "")          // drop apostrophes
    .replace(/[^a-z0-9À-ſ]+/gi, " ") // keep letters (incl. accents) & digits
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const picked = [];
  let chars = 0;
  for (const w of words) {
    if (picked.length >= MAX_SLUG_WORDS) break;
    if (picked.length >= 3 && chars + 1 + w.length > SLUG_CHAR_BUDGET) break;
    picked.push(w);
    chars += w.length + 1;
  }
  // Trim trailing stop-words so slugs don't end on "to"/"and"/etc.
  while (picked.length > 3 && STOPWORDS.has(picked[picked.length - 1])) {
    picked.pop();
  }
  return picked
    .join("-")
    .normalize("NFD").replace(/[̀-ͯ]/g, ""); // strip accents for ascii filename
}

function extractTitle($) {
  let t = ($("title").first().text() || "").trim();
  const bar = t.indexOf("|");
  if (bar > -1) t = t.slice(bar + 1).trim(); // drop "ProgressRail | " prefix
  return t;
}

function transformBody($) {
  const body = $("div.cmp-text").first();

  // <b> -> <strong>, <i> -> <em>
  body.find("b").each((_, el) => { el.tagName = "strong"; });
  body.find("i").each((_, el) => { el.tagName = "em"; });
  // DA strips redundant <strong> inside headings — match that.
  body.find("h1,h2,h3,h4,h5,h6").find("strong").toArray().forEach((s) => { const $s = $(s); $s.replaceWith($s.contents()); });
  // presentational <span class="..."> shouldn't pass through to EDS content.
  body.find("span[class]").toArray().forEach((s) => { const $s = $(s); $s.replaceWith($s.contents()); });
  body.find("a[target]").removeAttr("target"); // drop target attributes from links

  // Drop empty paragraphs.
  body.find("p").each((_, el) => {
    const $el = $(el);
    const txt = $el.text().replace(/ /g, " ").trim();
    if (txt === "" && $el.find("img").length === 0) $el.remove();
  });

  let html = body.html() || "";
  html = html.replace(/&nbsp;| /g, " "); // normalise non-breaking spaces
  html = html.replace(/>\s+</g, "><");         // drop whitespace-only gaps between tags
  html = html.replace(/[ \t\r\n]+/g, " ");     // collapse remaining whitespace
  return html.trim();
}

function pic(src, alt = "") {
  src = (src || "").replace(/^http:\/\//, "https://");
  return `<picture><source srcset="${src}">`
    + `<source srcset="${src}" media="(min-width: 600px)">`
    + `<img src="${src}" alt="${alt}" loading="lazy"></picture>`;
}

// Trailing images/videos (multimedia components) appended after the body.
function extractMedia($) {
  const out = [];
  const seen = new Set();
  $(".multimedia").each((_, mm) => {
    const $mm = $(mm);
    const slides = $mm.find(".multimedia__slide");
    (slides.length ? slides.toArray() : [mm]).forEach((s) => {
      const $s = $(s);
      let ytid = $s.find("[data-ytvideoid]").attr("data-ytvideoid")
        || $s.find("[data-videoid]").attr("data-videoid");
      if (!ytid) {
        const thumb = $s.find("img").map((i, im) => $(im).attr("src")).get()
          .find((x) => /(?:youtube\.com\/vi|ytimg\.com\/vi)\//.test(x || ""));
        const m = thumb && thumb.match(/\/vi\/([^/]+)\//);
        if (m) ytid = m[1];
      }
      if (ytid) {
        const url = `https://www.youtube.com/watch?v=${ytid}`;
        if (!seen.has(url)) { seen.add(url); out.push(`<p><a href="${url}">${url}</a></p>`); }
        return;
      }
      const src = $s.find("img").map((i, im) => $(im).attr("src")).get()
        .find((x) => x && !/[?&](cc-s|fmt=)/.test(x) && !/youtube|ytimg/.test(x));
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push(pic(src, $s.find("img").first().attr("alt") || ""));
        const cap = $s.find("[class*=imedia__description]").first().text().replace(/\s+/g, " ").trim();
        if (cap) out.push(`<p>${cap}</p>`);
      }
    });
  });
  return out.join("");
}

// Publication date as YYYY-MM-DD from the pubDateOnly meta.
function extractPubDate($) {
  const pub = $('meta[name="pubDateOnly"]').attr("content") || "";
  const m = pub.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractYear($) {
  // Authoritative: the <meta name="pubDateOnly" content="YYYY-MM-DD..."> tag.
  const pub = $('meta[name="pubDateOnly"]').attr("content");
  let m = pub && pub.match(/\b(19|20)\d{2}\b/);
  if (m) return m[0];
  // Fallback: a year in the body dateline.
  m = $("div.cmp-text").first().text().match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function findHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findHtml(full, acc);
    else if (e.isFile() && /\.html?$/i.test(e.name)) acc.push(full);
  }
  return acc;
}

// Match DA's serialization: literal nbsp, &#x26; for ampersands in attributes.
const daSerialize = (html) => html.replace(/="[^"]*"/g, (m) => m.replace(/&amp;/g, "&#x26;"));

function build(title, bodyHtml, pubDate) {
  const meta = pubDate
    ? `<div class="metadata"><div><div><p>Publication Date</p></div><div><p>${pubDate}</p></div></div></div>`
    : "";
  return daSerialize(
    "\n<body>\n" +
    "  <header></header>\n" +
    `  <main><div><h1>${title}</h1>${bodyHtml}${meta}</div></main>\n` +
    "  <footer></footer>\n" +
    "</body>\n"
  );
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = findHtml(SRC).sort();
  const used = new Map();
  const rows = [["source", "new_filename", "year", "title"]];
  let noYear = 0;

  for (const file of files) {
    const $ = cheerio.load(fs.readFileSync(file, "utf8"), { decodeEntities: false });
    const title = extractTitle($);
    const year = extractYear($) || "0000";
    if (year === "0000") noYear++;

    let base = `${year}-${slugify(title)}`;
    let name = `${base}.html`;
    let n = 2;
    while (used.has(name)) name = `${base}-${n++}.html`; // de-dupe collisions
    used.set(name, true);

    const out = build(title, transformBody($) + extractMedia($), extractPubDate($));
    fs.writeFileSync(path.join(OUT, name), out);
    rows.push([path.basename(file), name, year, title]);
  }

  if (MAP) {
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    fs.writeFileSync(MAP, csv);
  }

  console.log(`Transformed ${files.length} file(s) -> ${OUT}`);
  if (noYear) console.log(`  WARNING: ${noYear} file(s) had no detectable year (named 0000-…)`);
  if (MAP) console.log(`  Mapping written to ${MAP}`);
}

main();
