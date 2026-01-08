#!/usr/bin/env bash
set -euo pipefail

# Prepare static `out/` folder for manual upload to Cloudflare Pages (POSIX)
npm run build

if [ ! -d ".next/server/pages" ]; then
  echo "Expected .next/server/pages not found — build may have failed" >&2
  exit 1
fi

rm -rf out
mkdir -p out
cp -r .next/server/pages/* out/
[ -f _redirects ] && cp _redirects out/_redirects || true

echo "Prepared out/ — ready for upload to Cloudflare Pages"
