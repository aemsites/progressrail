#!/usr/bin/env node
/**
 * list-endpoints.js
 *
 * Scans cleaned Progress Rail pages and, for every AEM List component, prints
 * the "getDegSubList" endpoint that returns the COMPLETE set of list items
 * (the static HTML only contains the first page; the rest load dynamically).
 *
 * The endpoint is built from the list's data-list-resourcetype attribute:
 *   https://<host><PATH>.getDegSubListv10.html
 *     ?listResourcePath=<urlencoded PATH>&isLoadMore=0&paginateAfter=0&itemPerPage=<N>
 *
 * Output is TSV:  <page>\t<variant>\t<resourcePath>\t<url>
 * Pair it with --curl to emit a runnable curl script that saves each response
 * to  <outDir>/<sha-of-path>.json  so a transformer can read them back.
 *
 * Usage:
 *   node list-endpoints.js <cleanedDir> [--host https://www.progressrail.com]
 *                                       [--per 99] [--curl <outDir>]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");

const SRC = path.resolve(process.argv[2] || ".");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const HOST = arg("--host", "https://www.progressrail.com");
const PER = arg("--per", "99");
const curlIdx = process.argv.indexOf("--curl");
const CURL_DIR = curlIdx > -1 ? process.argv[curlIdx + 1] : null;

function endpointFor(resourcePath) {
  return (
    HOST + resourcePath + ".getDegSubListv10.html" +
    "?listResourcePath=" + encodeURIComponent(resourcePath) +
    "&isLoadMore=0&paginateAfter=0&itemPerPage=" + PER
  );
}
// Stable filename for a resource path (so the transformer can find the JSON).
const cacheName = (rp) => crypto.createHash("sha1").update(rp).digest("hex").slice(0, 16) + ".json";

function findHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findHtml(full, acc);
    else if (e.isFile() && /\.html?$/i.test(e.name)) acc.push(full);
  }
  return acc;
}

const rows = [];
for (const file of findHtml(SRC).sort()) {
  const $ = cheerio.load(fs.readFileSync(file, "utf8"), { decodeEntities: false });
  $(".list").each((_, L) => {
    const $L = $(L);
    const rp = $L.find("[data-list-resourcetype]").attr("data-list-resourcetype")
      || $L.attr("data-list-resourcetype");
    if (!rp) return;
    const variant = ($L.attr("class") || "").split(/\s+/)
      .filter((c) => c.startsWith("list--")).join(",") || "list";
    rows.push({ page: path.relative(SRC, file), variant, rp });
  });
}

// De-dupe by resource path (same list can appear via multiple selectors).
const seen = new Set();
const uniq = rows.filter((r) => (seen.has(r.rp) ? false : seen.add(r.rp)));

if (CURL_DIR) {
  const lines = ["#!/bin/sh", `mkdir -p '${CURL_DIR}'`];
  for (const r of uniq) {
    lines.push(`curl -s '${endpointFor(r.rp)}' -o '${path.join(CURL_DIR, cacheName(r.rp))}'  # ${r.variant} ${r.page}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
} else {
  for (const r of uniq) {
    process.stdout.write(`${r.page}\t${r.variant}\t${r.rp}\t${endpointFor(r.rp)}\n`);
  }
  process.stderr.write(`\n${uniq.length} unique list endpoint(s) across ${rows.length} list instance(s).\n`);
}
