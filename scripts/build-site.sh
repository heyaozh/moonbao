#!/usr/bin/env bash
# 介绍网站（W1）：app 用相对路径构建到 dist-site/app/，site/index.html 套上 HTML 外壳，media 一起拷过去。
# 部署到任何静态托管（GitHub Pages / Cloudflare Pages …）都行——部署前先问用户。
# 本地看：npx vite preview --outDir "$PWD/dist-site" --port 5190
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/dist-site"
npx vite build --base ./ --outDir "$OUT/app" --emptyOutDir
mkdir -p "$OUT/media"
cp site/media/* "$OUT/media/"
{
  echo '<!doctype html>'
  echo '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  sed -n '1,/<\/style>/p' site/index.html
  echo '</head><body>'
  sed '1,/<\/style>/d' site/index.html
  echo '</body></html>'
} > "$OUT/index.html"
echo "✓ $OUT"
