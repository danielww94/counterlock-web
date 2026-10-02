#!/usr/bin/env bash
# Puts together the published site from this repo, for deploy-site.yml (and
# layout-check.yml, so the check sees exactly what gets published).
# Usage: bash .github/build-site.sh <repo folder> <output folder> [Counterlock-web.zip]
#
# The site is the repo's files, minus git and GitHub settings and the notes
# for developers (README.md, CLAUDE.md), plus a copy of index.html in a folder
# for each page, so every page has a real address that Cloudflare Web
# Analytics counts on its own (it ignores #...). index.html stays the only
# source: the copies are made here and never committed. The page names must
# match pagePath in index.html.
#
# With Counterlock-web.zip (from the latest release), the web version goes in
# app/. Then build-pages.py, next to this script, adds the search details of
# each page, the counter pages (/counter/, made from the profile in app/),
# 404.html and sitemap.xml.
set -euo pipefail
src=$1
out=$2
zip=${3:-}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
shopt -s dotglob
for item in "$src"/*; do
  case "$(basename "$item")" in
    .git|.github|_site|README.md|CLAUDE.md) ;;
    *) cp -r "$item" "$out"/ ;;
  esac
done
# app/ is never taken from the repo, only from the release (see the top).
rm -rf "$out/app"
for page in download profiles privacy; do
  rm -rf "${out:?}/$page"
  mkdir "$out/$page"
  cp "$src/index.html" "$out/$page/index.html"
done
if [ -n "$zip" ]; then
  mkdir -p "$out/app"
  unzip -q "$zip" -d "$out/app"
fi
python3 "$here/build-pages.py" "$src" "$out"
