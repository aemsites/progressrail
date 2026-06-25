# Progress Rail import pipeline

Scripts that convert the legacy AEM site (a static crawl) into Edge Delivery
(EDS) document-authoring HTML in the content repo. All scripts are plain Node
and require `cheerio` (`npm install --save-dev cheerio`).

## Order of operations

### 0. Clean the crawl  (run on the downloaded site, not in this repo)

These two live with the downloaded site; they produce the `cleaned/` tree the
transformer reads:

1. `strip-nav-footer.js <srcDir> <outDir>` — remove the repeated global nav
   (`header.mega--nav`) and footer from every page.
2. `fix-image-src.js <targetDir>` — swap lazy-load `data-src`/`data-srcset` to
   real `src`/`srcset` and upgrade those image URLs to `https`.

### 1. Transform pages → EDS blocks

```
node transform-page.js <sourceRoot> <contentRoot>
```

- `<sourceRoot>`  cleaned site root (contains `en.html`, `fr.html`, `en/`, `fr/`)
- `<contentRoot>` the EDS content repo to write into

Converts all block-based pages (homepages → `<lang>/index.html`), skips
individual press releases, and writes/merges old→new redirects into
`<contentRoot>/redirects.json`. This is the main file; it also exports
`{ transformFile, kebabPath, runBatch }`.

### 2. Transform press releases

```
node transform-press-releases.js <srcDir> <outDir> [--map mapping.csv]
```

Press releases use a simpler title/date/body format and `YYYY-slug` filenames.

### 3. Rewrite links

```
node rewrite-links.js <contentRoot>
```

Makes `www.progressrail.com` links host-relative and swaps them to their
redirect `Destination`. Paths with no redirect are written to
`.aem/links-not-in-redirects.tsv` for review.

### 4. Fix any remaining http image sources

```
node fix-http-images.js <contentRoot>
```

Upgrades `src`/`srcset` from `http://` to `https://` (e.g. hand-edited pages
the transformer didn't generate).

## Analysis / utilities

- `analyze-blocks.js <cleanedDir> [--out report.md]` — reports which AEM
  components map to which EDS block, and flags anything still unmapped.
- `list-endpoints.js <cleanedDir> [--curl <outDir>]` — builds the
  `getDegSubList` endpoint URL for every paginated list (the static crawl only
  contains the first page of items). See `.aem/list-pagination-audit.csv`.

## Preserving human edits made in DA

Once pages are published, authors may edit them in DA. Re-running the transform
would overwrite those edits, so the flow becomes:

1. Pull the current DA content into `.aem/` (already present here).
2. `node reconcile.js <contentRoot> --apply` — compares the transform output
   against `.aem/`, ignoring DA's whitespace reformatting, and classifies each
   page as `identical`, `transform` (structure-only change — safe to take),
   `author-edit` (text changed — a human edited it) or `conflict` (both
   changed). Author-edit + conflict pages are written to
   `.aem/protected-files.json` and (with `--apply`) copied back into the working
   tree. See `.aem/reconcile-report.csv`.
3. `node transform-page.js <sourceRoot> <contentRoot> --skip-protected` — runs
   the transform but never overwrites anything in `protected-files.json`.

The protected list accumulates across runs, so protection sticks. `conflict`
pages (a human edit AND a transform change) keep the human version and should be
reconciled by hand.

## Known follow-ups

- Paginated lists: only the first page of items is in the crawl; fetch the full
  set via the endpoints from `list-endpoints.js`.
- `deg-title` headings and a few minor components are not yet mapped.
