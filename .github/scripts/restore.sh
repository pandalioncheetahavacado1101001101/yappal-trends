#!/usr/bin/env bash
# Before a cycle: the feed already published, so a cycle that publishes nothing leaves it as it was and the collector never puts out
# an older list over a newer one. The state folder comes from the Actions cache alone.
set -u
FEED_REMOTE="${FEED_REMOTE:?FEED_REMOTE is not set}"

mkdir -p state out
if [ -z "$(ls -A out)" ]; then
  tmp="$(mktemp -d)"
  if git -C "$tmp" init -q && git -C "$tmp" fetch -q --depth=1 "$FEED_REMOTE" feed 2>/dev/null; then
    git -C "$tmp" archive FETCH_HEAD | tar -x -C out && echo "fetched the feed already out"
  else
    echo "no feed published yet"
  fi
  rm -rf "$tmp"
fi
# a lock saved by a run that was cut off belongs to a machine that no longer exists
rm -f state/lock
exit 0
