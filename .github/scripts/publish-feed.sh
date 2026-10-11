#!/usr/bin/env bash
# The feed as the single commit of the "feed" branch: phones read it from raw.githubusercontent.com/<owner>/<repo>/feed/v1/...
set -euo pipefail
REMOTE="${FEED_REMOTE:?FEED_REMOTE is not set}"
[ -f out/v1/us.json ] || { echo "no feed to publish"; exit 1; }

tmp="$(mktemp -d)"
cp -R out/. "$tmp/"
cd "$tmp"
git init -q -b feed
git add -A
git -c user.name="ideas-collector" -c user.email="ideas-collector@users.noreply.github.com" commit -q -m "feed $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$REMOTE" feed
echo "published $(find v1 -type f | wc -l | tr -d ' ') files"
