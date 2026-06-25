#!/usr/bin/env node
/**
 * reconcile.js
 *
 * Protects human edits made in DA from being clobbered when the transform is
 * re-run. Compares the freshly transformed output (en/, fr/) against the
 * version pulled from DA (.aem/) and classifies every page, ignoring DA's
 * whitespace reformatting:
 *
 *   identical    - same content
 *   transform    - only the block STRUCTURE changed (a transform improvement);
 *                  safe to take the new output
 *   author-edit  - the TEXT/content changed but structure didn't -> a human
 *                  edited it in DA; preserve the DA version
 *   conflict     - both the author and the transform changed it -> preserve the
 *                  DA version and flag for manual review
 *
 * The set of author-edit + conflict pages is written to
 * .aem/protected-files.json (UNION with any prior list, so protection sticks).
 * Run the transform with --skip-protected and it will never overwrite them.
 *
 * With --apply, those pages are copied from .aem back into en//fr/ so the
 * working tree holds the human edits.
 *
 * Usage:
 *   node reconcile.js <repoRoot> [--apply]
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const REPO = path.resolve(process.argv[2]);
const APPLY = process.argv.includes("--apply");
const AEM = path.join(REPO, ".aem");

function walk(dir, base, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, base, acc);
    else if (/\.html$/.test(e.name)) acc.push(path.relative(base, f));
  }
  return acc;
}

const BLOCK_RE = /^(hero|banner|cards|columns|carousel|accordion|tabs|jump-nav|list|metadata|section-metadata)\b/;

// Semantic signature: block-structure sequence + normalised text.
// Whitespace-insensitive, so DA's serializer reformatting is not seen as a change.
function signature(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const main = $("main");
  const struct = [];
  main.find("div[class]").each((_, d) => {
    const c = ($(d).attr("class") || "").trim();
    if (BLOCK_RE.test(c)) struct.push(c);
  });
  return { struct: struct.join("|"), text: main.text().replace(/\s+/g, " ").trim() };
}

// Detect text edits robustly: compare the multiset of "words" so a reordered
// block doesn't read as a content change.
const wordbag = (t) => t.toLowerCase().match(/[a-z0-9à-ÿ]+/gi) || [];
function textChanged(a, b) {
  const A = wordbag(a).sort().join(" "), B = wordbag(b).sort().join(" ");
  return A !== B;
}

const protectedPath = path.join(__dirname, "protected-files.json"); // tooling state, kept out of content
const prior = fs.existsSync(protectedPath) ? new Set(JSON.parse(fs.readFileSync(protectedPath, "utf8"))) : new Set();

const files = [...walk(path.join(REPO, "en"), REPO), ...walk(path.join(REPO, "fr"), REPO)].sort();
const report = [["file", "classification"]];
const tally = {};
const nowProtected = new Set(prior);
let applied = 0;

for (const rel of files) {
  const aemFile = path.join(AEM, rel);
  if (!fs.existsSync(aemFile)) { report.push([rel, "new"]); tally.new = (tally.new || 0) + 1; continue; }
  const N = signature(fs.readFileSync(path.join(REPO, rel), "utf8"));
  const A = signature(fs.readFileSync(aemFile, "utf8"));
  const txt = textChanged(A.text, N.text);
  const struct = A.struct !== N.struct;

  let cls = (!txt && !struct) ? "identical"
    : !txt ? "transform"
      : struct ? "conflict" : "author-edit";

  if (cls === "author-edit" || cls === "conflict") {
    nowProtected.add(rel);
    if (APPLY) { fs.writeFileSync(path.join(REPO, rel), fs.readFileSync(aemFile, "utf8")); applied++; }
  }
  report.push([rel, cls]);
  tally[cls] = (tally[cls] || 0) + 1;
}

fs.writeFileSync(protectedPath, JSON.stringify([...nowProtected].sort(), null, 2));
fs.writeFileSync(path.join(__dirname, "reconcile-report.csv"),
  report.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n"));

console.log(`reconciled ${files.length} files`);
Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
console.log(`protected list: ${nowProtected.size} files (${path.relative(process.cwd(), protectedPath)})`);
if (APPLY) console.log(`  applied ${applied} DA version(s) to the working tree`);
else console.log(`  report-only; rerun with --apply to copy DA edits into en//fr/`);
