#!/usr/bin/env node
/**
 * merge-pr-redirects.js
 *
 * Builds the press-release old->new redirects from transform-press-releases.js
 * --map output(s) and merges them into <contentRoot>/redirects.json.
 *
 *   node merge-pr-redirects.js <contentRoot> <map-en.csv> [<map-fr.csv> ...]
 *
 * The language is taken from the map filename (…-fr… => fr, else en).
 */
const fs = require("fs");
const path = require("path");

const CONTENT = path.resolve(process.argv[2]);
const maps = process.argv.slice(3);

function load(f) {
  return fs.readFileSync(f, "utf8").split("\n").slice(1).filter(Boolean)
    .map((l) => l.match(/"((?:[^"]|"")*)"/g).map((s) => s.slice(1, -1).replace(/""/g, '"')));
}

const reds = [];
for (const m of maps) {
  const lang = /(^|[^a-z])fr([^a-z]|$)/i.test(path.basename(m)) ? "fr" : "en";
  for (const [src, nw] of load(m)) {
    reds.push({
      Source: `/${lang}/Company/News/PressReleases/${src}`,
      Destination: `/${lang}/company/news/press-releases/${nw.replace(/\.html?$/i, "")}`,
    });
  }
}

const rp = path.join(CONTENT, "redirects.json");
const sheet = JSON.parse(fs.readFileSync(rp, "utf8"));
const seen = new Set(reds.map((r) => r.Source));
const merged = reds.concat((sheet.data || []).filter((r) => !seen.has(r.Source)))
  .sort((a, b) => a.Source.localeCompare(b.Source));
sheet.data = merged; sheet.total = merged.length; sheet.limit = merged.length; sheet.offset = 0;
fs.writeFileSync(rp, JSON.stringify(sheet));
console.log(`press-release redirects: ${reds.length} merged, ${merged.length} total in redirects.json`);
