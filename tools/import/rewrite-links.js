#!/usr/bin/env node
/**
 * rewrite-links.js
 *
 * Walks the content/aemsites/progressrail folder and fixes every absolute link
 * that points at the Progress Rail host:
 *
 *   1. Strips the host so the link is relative to the host:
 *        href="https://www.progressrail.com/en/Company.html"  ->  /en/Company.html
 *   2. If that host-relative path is a Source in redirects.json, rewrites it to
 *        the matching Destination:
 *        /en/Company.html  ->  /en/company
 *      (any #fragment or ?query is preserved).
 *
 * Links whose path is NOT found in redirects.json are still made host-relative,
 * and are written to a review file so they can be checked / given redirects.
 *
 * Usage:
 *   node rewrite-links.js <repoRoot> [--review <file>] [--dry]
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(process.argv[2]);
const reviewIdx = process.argv.indexOf("--review");
const REVIEW = reviewIdx > -1 ? path.resolve(process.argv[reviewIdx + 1])
  : path.join(__dirname, "links-not-in-redirects.tsv"); // beside the script, not in content
const DRY = process.argv.includes("--dry");

const redirects = JSON.parse(fs.readFileSync(path.join(REPO, "redirects.json"), "utf8"));
const map = new Map((redirects.data || []).map((r) => [r.Source, r.Destination]));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".aem" || e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc);
    else if (/\.html?$/i.test(e.name)) acc.push(f);
  }
  return acc;
}

// Any href; we then decide if it's a host-absolute or root-relative internal link.
const RE = /href="([^"]*)"/gi;
const HOST = /^https?:\/\/(?:www\.)?progressrail\.com/i;

const notFound = new Map(); // basePath -> { count, files:Set }
let filesChanged = 0, rewritten = 0, hostRelOnly = 0;

for (const file of walk(REPO)) {
  const orig = fs.readFileSync(file, "utf8");
  let changed = false;
  const record = (basePath) => {
    if (!notFound.has(basePath)) notFound.set(basePath, { count: 0, files: new Set() });
    const e = notFound.get(basePath); e.count++; e.files.add(path.relative(REPO, file));
  };
  const out = orig.replace(RE, (m, value) => {
    let rest, isHost = false;
    if (HOST.test(value)) { rest = value.replace(HOST, ""); isHost = true; }
    else if (value.startsWith("/")) { rest = value; }       // root-relative internal link
    else return m;                                           // external / mailto / #anchor / other
    const cut = rest.search(/[#?]/);
    let basePath = cut >= 0 ? rest.slice(0, cut) : rest;
    const suffix = cut >= 0 ? rest.slice(cut) : "";
    if (basePath === "") basePath = "/";

    if (map.has(basePath)) { changed = true; rewritten++; return `href="${map.get(basePath)}${suffix}"`; }
    if (isHost) {                                            // strip host even if no redirect
      changed = true; hostRelOnly++; record(basePath);
      return `href="${basePath}${suffix}"`;
    }
    // root-relative not in redirects: leave as-is, but flag genuine internal page links
    if (/^\/(?:en|fr)\/.+\.html?$/i.test(basePath)) record(basePath);
    return m;
  });
  if (changed && !DRY) { fs.writeFileSync(file, out); }
  if (changed) filesChanged++;
}

// Write the review list (paths not covered by a redirect).
const rows = [["host_relative_path", "occurrences", "example_file"]];
[...notFound.entries()]
  .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  .forEach(([p, e]) => rows.push([p, String(e.count), [...e.files][0]]));
if (!DRY) {
  fs.mkdirSync(path.dirname(REVIEW), { recursive: true });
  fs.writeFileSync(REVIEW, rows.map((r) => r.join("\t")).join("\n"));
}

console.log(`${DRY ? "[dry-run] " : ""}files touched: ${filesChanged}`);
console.log(`links rewritten via redirect: ${rewritten}`);
console.log(`links made host-relative but NOT in redirects: ${hostRelOnly} (${notFound.size} distinct paths)`);
console.log(`review file: ${REVIEW}`);
