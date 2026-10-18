#!/usr/bin/env bash
# The ledger: one JSON line per run, appended to ledger.jsonl at the root of the "feed" branch (beside v1/), capped to 7 days,
# so lead time and cadence can be read from the branch alone (.github/scripts/ledger.js writes the line).
#
# Runs inside the cycle job, after the feed is published (when it was) and the state saved, within the concurrency group: it never
# races another run's publish. The branch is fetched fresh here (never out/, whose contents are the collector's), the line is
# appended, and the branch is published again as a single commit, the way publish-feed.sh publishes the feed. A feed branch that
# does not exist yet, or holds no feed, gets no ledger: the ledger never makes the branch. Exits 0 whatever happens: a ledger line
# is never a reason for a job to fail.
set -u
REMOTE="${FEED_REMOTE:?FEED_REMOTE is not set}"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
work="$tmp/work"
done_() { rm -rf "$tmp"; exit 0; }

mkdir -p "$work"
if ! git -C "$tmp" init -q || ! git -C "$tmp" fetch -q --depth=1 "$REMOTE" feed 2>/dev/null; then
  echo "ledger: no feed branch yet: no line"; done_
fi
git -C "$tmp" archive FETCH_HEAD | tar -x -C "$work" || { echo "ledger: the feed branch could not be read: no line"; done_; }
[ -f "$work/v1/us.json" ] || { echo "ledger: the feed branch holds no feed: no line"; done_; }

if ! node "$SELF/ledger.js" "$work/ledger.jsonl"; then echo "ledger: the line was not written"; done_; fi

cd "$work" || done_
git init -q -b feed
git add -A
git -c user.name="ideas-collector" -c user.email="ideas-collector@users.noreply.github.com" commit -q -m "feed $(date -u +%Y-%m-%dT%H:%MZ) + ledger"
if git push -q -f "$REMOTE" feed; then
  echo "ledger: $(wc -l < ledger.jsonl | tr -d ' ') lines on the feed branch"
else
  echo "ledger: the push failed; the line is lost (the next run writes its own)"
fi
done_
