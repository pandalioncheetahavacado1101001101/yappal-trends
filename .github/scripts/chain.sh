#!/usr/bin/env bash
# The chain: each run of collect.yml dispatches the run after it, timed to the next quarter-hour, so the collector keeps a real
# 15-minute cadence although GitHub's cron fires only about half of its slots (the cron stays as the watchdog).
#
#   .github/scripts/chain.sh gate    (the "gate" job, before the cycle; seconds)
#       Writes go=true|false to $GITHUB_OUTPUT. A run the cron started (STARTED_BY=schedule) that finds any OTHER run of this
#       workflow queued or in progress ends here (go=false): the chain is alive, and queuing up behind it would make GitHub
#       cancel the run already waiting its turn (one waiting run per concurrency group). A chained or hand-started run always
#       goes on. If GitHub cannot be asked, the run goes on: the cycle's own guards make a double run publish nothing.
#
#   .github/scripts/chain.sh next    (the "next" job, after a cycle that succeeded; at most 16 minutes)
#       Dispatches the next run ("gh workflow run <workflow> -f chain=true", the built-in token) at the next quarter-hour:
#       sleeps until 60 seconds before it (14 minutes at most), then dispatches, so a run is always queued, running or sleeping
#       here and the cron and the chain never both run a cycle. Dispatches nothing when the cycle did not succeed (CYCLE_RESULT
#       is anything but "success": the collector failed, exit 3 or more, or the job hit its cap; the cron watchdog restarts the
#       chain within a slot or two, which is the old cadence and safe, where a chain that went on would send a failing cycle's
#       full round of requests ten or twelve times an hour with no end), when this run was not started by schedule or dispatch,
#       when the repository variable IDEAS_CHAIN is "off", or when another DISPATCHED run is already queued or in progress (that
#       run carries the chain). A watchdog run (the cron's) or a push run never carries it: a watchdog that finds this run in
#       progress ends at its gate, and a push run dispatches nothing. (Before 2026-10-28 evening any other run counted: a watchdog
#       that fired in the seconds before this run's dispatch saw this run and ended at its gate, this run saw the watchdog and
#       dispatched nothing, and the chain stood for an hour, 13:59Z to 14:55Z on 2026-10-28, until the cron fired again.) The
#       dispatch itself failing fails this job, so it shows: the next cron run that fires starts the chain again.
#
#   .github/scripts/chain.sh align   (the cycle job, after its restores and just before the collector runs; at most 2 minutes)
#       The collector's slot is the quarter-hour its clock is in (lib/util.js slotOf). With no model to start (ios/IDEAS-SUPER.md
#       P11) a chained run is ready about 35 s BEFORE the quarter-hour it was dispatched for: run then, it would take the slot before
#       (already out) and publish it a quarter-hour late. So when the next quarter-hour is ALIGN_MAX_SECONDS (120) away or less,
#       this sleeps until ALIGN_MARGIN_SECONDS (2) past it; any other run (the cron's watchdog at :07, a run by hand) starts at once.
#
#   .github/scripts/chain.sh enrich  (the cycle job, after a feed was published and the state saved; seconds)
#       Dispatches the enrich pass (enrich.yml: the model's cards, written from the plan this cycle left in its state, for the next
#       cycle to import), handing it the state's key (ENRICH_STATE_KEY). Its own workflow and concurrency group: it never holds this
#       job or the chain up, and a failure to dispatch is a warning, never a failed job. Nothing when the repository variable
#       IDEAS_ENRICH is "off" or IDEAS_EDITOR_OFF is "1" (EDITOR_OFF): the feed goes on with the cards it holds.
#
# Environment: GH_TOKEN, GH_REPO (the gh CLI); GITHUB_RUN_ID, GITHUB_EVENT_NAME, GITHUB_OUTPUT (the runner); STARTED_BY
# (schedule | chain | hand, from the workflow); CHAIN_REF (the branch to dispatch on); IDEAS_CHAIN (the variable); CYCLE_RESULT
# (the cycle job's result, from the workflow: success | failure | cancelled | skipped; unset reads as success).
# GH_BIN names another gh (a fake, to try the arithmetic on a machine with no token); WORKFLOW another workflow file;
# CHAIN_NOW pins "now" (epoch seconds) and SLEEP_BIN names another sleep, so the timing can be tried without waiting.
# enrich: ENRICH_WORKFLOW (enrich.yml), ENRICH_STATE_KEY, IDEAS_ENRICH, EDITOR_OFF.
set -u
MODE="${1:-}"
GH="${GH_BIN:-gh}"
WORKFLOW="${WORKFLOW:-collect.yml}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
ME="${GITHUB_RUN_ID:-0}"
SLOT_SECONDS=900          # a quarter-hour
LEAD_SECONDS=60           # dispatch this long before the quarter-hour: the run is queued and on a runner by it
SLEEP_MAX_SECONDS=840     # never sleep longer than this (wall time on the runner): a whole slot less the lead, inside the job's cap
SLEEP="${SLEEP_BIN:-sleep}"
ALIGN_MAX_SECONDS=120     # align: wait for a quarter-hour this near, no further
ALIGN_MARGIN_SECONDS=2    # align: and start this long after it, so the collector's clock is surely in the new slot
ENRICH_WORKFLOW="${ENRICH_WORKFLOW:-enrich.yml}"

# The other runs of this workflow that are queued or in progress, one per line ("<id> <event> <status>"); empty when none.
# A failure to ask prints nothing on stdout and "?" on stderr-side via the return code.
others() {
  "$GH" run list --workflow "$WORKFLOW" --limit 30 --json databaseId,event,status \
    --jq ".[] | select(.databaseId != $ME) | select(.status == \"queued\" or .status == \"in_progress\" or .status == \"waiting\" or .status == \"pending\" or .status == \"requested\") | \"\(.databaseId) \(.event) \(.status)\""
}

# Of those, the runs that carry a chain: dispatched ones (by the run before them or by hand). A watchdog run ends at its gate when
# it finds this run, and a push run dispatches nothing, so "next" never stands down for either. Same return code as others().
carriers() {
  local list
  list="$(others)" || return 1
  printf '%s\n' "$list" | awk '$2 == "workflow_dispatch"'
}

gate() {
  if [ "${STARTED_BY:-}" != "schedule" ]; then
    echo "started by ${STARTED_BY:-dispatch}: the cycle goes on"
    echo "go=true" >> "$OUT"; return 0
  fi
  list="$(others)"; asked=$?
  if [ "$asked" -ne 0 ]; then
    echo "the watchdog could not ask GitHub for the runs in progress (gh exit $asked): the cycle goes on"
    echo "go=true" >> "$OUT"; return 0
  fi
  if [ -n "$list" ]; then
    echo "the watchdog finds the chain alive, nothing to do:"; echo "$list" | sed 's/^/  run /'
    echo "go=false" >> "$OUT"; return 0
  fi
  echo "the watchdog finds no run queued or in progress: the chain is restarted from this run"
  echo "go=true" >> "$OUT"
}

next() {
  # (a cycle that failed or hit its cap ends the chain here: its state was not saved, so its successor would send the same full
  # round of requests to the same failure, at once, again and again. The cron watchdog restarts the chain within a slot or two)
  if [ -n "${CYCLE_RESULT:-}" ] && [ "${CYCLE_RESULT}" != "success" ]; then
    echo "the cycle did not succeed (${CYCLE_RESULT}): no run dispatched; the next cron run that fires starts the chain again"
    return 0
  fi
  case "${GITHUB_EVENT_NAME:-}" in
    schedule|workflow_dispatch) ;;
    *) echo "started by '${GITHUB_EVENT_NAME:-}': only a run started by schedule or dispatch dispatches the next one"; return 0 ;;
  esac
  if [ "${IDEAS_CHAIN:-}" = "off" ]; then echo "the repository variable IDEAS_CHAIN is off: no run dispatched (the cron goes on)"; return 0; fi
  list="$(carriers)"; asked=$?
  if [ "$asked" -ne 0 ]; then echo "GitHub could not be asked for the runs in progress (gh exit $asked): dispatching anyway"; fi
  if [ -n "$list" ]; then echo "another dispatched run is already queued or in progress, it carries the chain:"; echo "$list" | sed 's/^/  run /'; return 0; fi

  now="${CHAIN_NOW:-$(date +%s)}"
  slot=$(( (now / SLOT_SECONDS + 1) * SLOT_SECONDS ))
  wait=$(( slot - LEAD_SECONDS - now ))
  slot_at="$(date -u -d "@$slot" +%H:%MZ 2>/dev/null || date -u -r "$slot" +%H:%MZ)"
  # (never past the job's own cap: a quarter-hour is at most 15 minutes off, so this is never more than SLEEP_MAX_SECONDS; said anyway)
  if [ "$wait" -gt "$SLEEP_MAX_SECONDS" ]; then wait="$SLEEP_MAX_SECONDS"; fi
  if [ "$wait" -gt 0 ]; then
    echo "the next quarter-hour is $slot_at: sleeping $wait s, then dispatching"
    "$SLEEP" "$wait"
    # (a run started by hand meanwhile carries the chain; a watchdog that fired meanwhile ends at its gate, so it never does)
    list="$(carriers)" || list=""
    if [ -n "$list" ]; then echo "a dispatched run arrived meanwhile, it carries the chain:"; echo "$list" | sed 's/^/  run /'; return 0; fi
  else
    echo "the next quarter-hour ($slot_at) is under $LEAD_SECONDS s away: dispatching at once"
  fi

  before="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! "$GH" workflow run "$WORKFLOW" --ref "${CHAIN_REF:-main}" -f chain=true; then
    echo "::error::the next run was not dispatched (gh workflow run failed): the chain ends here until the next cron run that fires"
    return 1
  fi
  echo "dispatched the next run of $WORKFLOW on ${CHAIN_REF:-main} at $(date -u +%H:%M:%SZ)"
  # (best effort: the run appears a few seconds later; shown when it does, never waited for beyond 30 s)
  for _ in $(seq 1 15); do
    sleep 2
    id="$("$GH" run list --workflow "$WORKFLOW" --limit 5 --json databaseId,event,createdAt \
      --jq ".[] | select(.event == \"workflow_dispatch\" and .createdAt >= \"$before\") | .databaseId" 2>/dev/null | head -n 1)"
    if [ -n "$id" ]; then echo "the next run is $id"; return 0; fi
  done
  echo "the next run is not listed yet (it was accepted)"
  return 0
}

align() {
  now="${CHAIN_NOW:-$(date +%s)}"
  slot=$(( (now / SLOT_SECONDS + 1) * SLOT_SECONDS ))
  away=$(( slot - now ))
  slot_at="$(date -u -d "@$slot" +%H:%MZ 2>/dev/null || date -u -r "$slot" +%H:%MZ)"
  if [ "$away" -gt "$ALIGN_MAX_SECONDS" ]; then
    echo "the quarter-hour began $(( now % SLOT_SECONDS )) s ago: the cycle starts now"
    return 0
  fi
  echo "the next quarter-hour is $slot_at, $away s away: the cycle starts $ALIGN_MARGIN_SECONDS s after it"
  "$SLEEP" "$(( away + ALIGN_MARGIN_SECONDS ))"
  return 0
}

enrich() {
  if [ "${IDEAS_ENRICH:-}" = "off" ]; then echo "the repository variable IDEAS_ENRICH is off: no enrich pass"; return 0; fi
  if [ "${EDITOR_OFF:-}" = "1" ]; then echo "the repository variable IDEAS_EDITOR_OFF is 1: no enrich pass"; return 0; fi
  if ! "$GH" workflow run "$ENRICH_WORKFLOW" --ref "${CHAIN_REF:-main}" -f state_key="${ENRICH_STATE_KEY:-}"; then
    echo "::warning::the enrich pass was not dispatched (gh workflow run failed): the feed keeps the cards it holds"
    return 0
  fi
  echo "dispatched the enrich pass ($ENRICH_WORKFLOW on ${CHAIN_REF:-main}) for this cycle's plan"
  return 0
}

case "$MODE" in
  gate) gate ;;
  next) next ;;
  align) align ;;
  enrich) enrich ;;
  *) echo "usage: chain.sh gate | next | align | enrich" >&2; exit 2 ;;
esac
