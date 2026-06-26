#!/usr/bin/env node
/**
 * fix-http-images.js
 *
 * Upgrades image sources from http:// to https:// across the repo. Scoped to
 * src="..." and srcset="..." attribute values only, so external href links
 * (which may not support https) are left untouched.
 *
 * Usage: node fix-http-images.js <repoRoot>
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(process.argv[2]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".aem" || e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc);
    else if (/\.html?$/i.test(e.name)) acc.push(f);
  }
  return acc;
}

let filesChanged = 0, occurrences = 0;
// Match any http/https scheme (any case, e.g. stray "httpS://") in an image
// attribute and force it to canonical lowercase https://.
const RE = /\b(src|srcset)="https?:\/\//gi;

for (const file of walk(REPO)) {
  const orig = fs.readFileSync(file, "utf8");
  let n = 0;
  const out = orig.replace(RE, (m, attr) => {
    const fixed = `${attr}="https://`;
    if (m === fixed) return m;          // already canonical, leave as-is
    n++; return fixed;
  });
  if (n > 0) { fs.writeFileSync(file, out); filesChanged++; occurrences += n; }
}
console.log(`image sources normalized to https://: ${occurrences} in ${filesChanged} file(s)`);
