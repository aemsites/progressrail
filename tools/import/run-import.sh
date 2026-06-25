#!/bin/sh
# Full import pipeline, in the required order. Run as:
#   tools/import/run-import.sh <sourceRoot> <contentRoot>
#
#   <sourceRoot>  cleaned crawl (contains en.html, fr.html, en/, fr/)
#   <contentRoot> EDS content repo (e.g. .../content/aemsites/progressrail)
#
# IMPORTANT: rewrite-links must run AFTER the transforms, because the transform
# emits links in their raw source form (/en/Company.html). This wrapper keeps
# that ordering so a transform is never left without the link-rewrite after it.
set -e

SRC="$1"; CONTENT="$2"
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -z "$SRC" ] || [ -z "$CONTENT" ]; then
  echo "usage: run-import.sh <sourceRoot> <contentRoot>"; exit 1
fi

echo "1/5 block pages (skipping protected/author-edited)…"
node "$DIR/transform-page.js" "$SRC" "$CONTENT" --skip-protected

echo "2/5 press releases…"
node "$DIR/transform-press-releases.js" "$SRC/en/Company/News/PressReleases" \
  "$CONTENT/en/company/news/press-releases" --map "$DIR/.pr-map-en.csv"
node "$DIR/transform-press-releases.js" "$SRC/fr/Company/News/PressReleases" \
  "$CONTENT/fr/company/news/press-releases" --map "$DIR/.pr-map-fr.csv"

echo "3/5 merge press-release redirects…"
node "$DIR/merge-pr-redirects.js" "$CONTENT" "$DIR/.pr-map-en.csv" "$DIR/.pr-map-fr.csv"

echo "4/5 rewrite links (host-absolute + root-relative -> redirect destinations)…"
node "$DIR/rewrite-links.js" "$CONTENT"

echo "5/5 upgrade http image sources to https…"
node "$DIR/fix-http-images.js" "$CONTENT"

echo "import pipeline complete."
