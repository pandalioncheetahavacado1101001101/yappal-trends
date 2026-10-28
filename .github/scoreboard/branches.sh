#!/usr/bin/env bash
# The scoreboard's git and cache chores (.github/workflows/scoreboard.yml), one per argument:
#
#   fetch        the feed branch's ledger.jsonl and v1/us.json into sbfeed/, and the scoreboard branch's days.jsonl into sbbranch/
#                (read back before appending). Only a branch the remote says it does not hold (ls-remote exit 2) reads as absent
#                ("none yet"), and only a file the fetched branch does not hold is left out. Any failed read of the remote, of a
#                branch it holds or of a file in it exits 1 after three tries, so nothing is scored or published that day: a failed
#                read taken for "none yet" would publish one day in place of every earlier one.
#   publish      latest.json and days.jsonl from sbout/, after the aggregate guard passes on both (and depth.json when depth.js wrote
#                it), as the SINGLE commit of the "scoreboard" branch (force-pushed: no history is kept, as the feed branch keeps
#                none). Never the feed branch.
#                Refused when days were read back and sbout/days.jsonl holds fewer lines than min(those, daysKept).
#   prune-cache  this workflow's own superseded history caches: every "scoreboard-history-*" key except KEEP, each deleted by its
#                exact key. Nothing else is ever touched: not "state-*" (restored read only, never saved here), not "editor-model-*".
#
# Prints counts and outcomes only: never a file's contents, a title or a key's contents beyond its fixed prefix.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="scoreboard-history-"
TRIES="${SCOREBOARD_TRIES:-3}"
PAUSE="${SCOREBOARD_PAUSE:-10}"

# heads <branch>: 0 the remote holds it, 2 the remote answered without it, anything else the remote could not be read (after TRIES)
heads() {
  local code=1 i
  for ((i = 1; i <= TRIES; i++)); do
    code=0; git ls-remote -q --exit-code --heads origin "$1" > /dev/null 2>&1 || code=$?
    if [ "$code" = "0" ] || [ "$code" = "2" ]; then break; fi
    [ "$i" -lt "$TRIES" ] && sleep "$PAUSE"
  done
  echo "$code"
}
# fetched <branch>: the branch at FETCH_HEAD, or exit 1 (after TRIES)
fetched() {
  local i
  for ((i = 1; i <= TRIES; i++)); do
    git fetch -q --depth=1 origin "$1" 2>/dev/null && return 0
    [ "$i" -lt "$TRIES" ] && sleep "$PAUSE"
  done
  echo "$1 branch: the fetch failed: nothing scored"; exit 1
}
# copy <path in FETCH_HEAD> <file>: absent when the branch does not hold the path; exit 1 when it does and it cannot be read
copy() {
  git cat-file -e "FETCH_HEAD:$1" 2>/dev/null || return 0
  git show "FETCH_HEAD:$1" > "$2" 2>/dev/null || { rm -f "$2"; echo "$1 could not be read: nothing scored"; exit 1; }
}

case "${1:-}" in
  fetch)
    mkdir -p sbfeed sbbranch
    rm -f sbfeed/ledger.jsonl sbfeed/us.json sbbranch/days.jsonl
    code="$(heads feed)"
    if [ "$code" = "0" ]; then
      fetched feed
      copy ledger.jsonl sbfeed/ledger.jsonl
      copy v1/us.json sbfeed/us.json
    elif [ "$code" != "2" ]; then
      echo "the remote could not be read (exit $code): nothing scored"; exit 1
    fi
    echo "feed branch: ledger $( [ -s sbfeed/ledger.jsonl ] && grep -c . sbfeed/ledger.jsonl || echo 0) lines, list $( [ -s sbfeed/us.json ] && echo read || echo absent)"
    code="$(heads scoreboard)"
    if [ "$code" = "2" ]; then
      echo "scoreboard branch: none yet"
    elif [ "$code" = "0" ]; then
      fetched scoreboard
      git cat-file -e FETCH_HEAD:days.jsonl 2>/dev/null || { echo "scoreboard branch: it holds no days.jsonl: nothing scored"; exit 1; }
      copy days.jsonl sbbranch/days.jsonl
      echo "scoreboard branch: $(grep -c . sbbranch/days.jsonl || true) days read back"
    else
      echo "the scoreboard branch could not be read (exit $code): nothing scored"; exit 1
    fi
    ;;
  publish)
    REMOTE="${SCOREBOARD_REMOTE:?SCOREBOARD_REMOTE is not set}"
    [ -s sbout/latest.json ] && [ -s sbout/days.jsonl ] || { echo "nothing to publish"; exit 1; }
    node "$HERE/report.js" --check sbout/latest.json sbout/days.jsonl
    # (a branch read back never shrinks, but to daysKept: one bad read can never publish one day over the record)
    if [ -f sbbranch/days.jsonl ]; then
      kept="$(node -e 'process.stdout.write(String(require(process.argv[1]).publish.daysKept))' "$HERE/scoreboard-spec.json")"
      before="$(grep -c . sbbranch/days.jsonl || true)"; after="$(grep -c . sbout/days.jsonl || true)"
      floor=$(( before < kept ? before : kept ))
      [ "$after" -ge "$floor" ] || { echo "days.jsonl would fall from $before to $after lines: nothing published"; exit 1; }
    fi
    tmp="$(mktemp -d)"
    cp sbout/latest.json sbout/days.jsonl "$tmp/"
    # (the list's depth, wave 9: written by depth.js only after its own aggregate guard passed; a day without it publishes without)
    if [ -s sbout/depth.json ]; then cp sbout/depth.json "$tmp/"; fi
    cd "$tmp"
    git init -q -b scoreboard
    git add latest.json days.jsonl
    if [ -f depth.json ]; then git add depth.json; fi
    git -c user.name="ideas-scoreboard" -c user.email="ideas-scoreboard@users.noreply.github.com" commit -q -m "scoreboard $(date -u +%Y-%m-%d)"
    git push -q -f "$REMOTE" scoreboard
    echo "published the scoreboard branch: $(grep -c . days.jsonl) days"
    ;;
  prune-cache)
    KEEP="${KEEP:?KEEP is not set}"
    case "$KEEP" in "$PREFIX"*) ;; *) echo "KEEP is not a scoreboard key: nothing deleted"; exit 0 ;; esac
    keys="$(gh cache list --key "$PREFIX" --limit 100 --json key --jq '.[].key' 2>/dev/null)" || { echo "the cache list could not be read: nothing deleted"; exit 0; }
    printf '%s\n' "$keys" | grep -qxF "$KEEP" || { echo "today's history is not listed yet: nothing deleted"; exit 0; }
    n=0; failed=0
    while IFS= read -r key; do
      [ -n "$key" ] || continue
      case "$key" in "$PREFIX"*) ;; *) continue ;; esac
      [ "$key" = "$KEEP" ] && continue
      if gh cache delete "$key" >/dev/null 2>&1; then n=$((n + 1)); else failed=$((failed + 1)); fi
    done <<< "$keys"
    echo "history caches: $n superseded deleted, $failed refused"
    ;;
  *) echo "usage: branches.sh fetch | publish | prune-cache" >&2; exit 2 ;;
esac
