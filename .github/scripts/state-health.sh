#!/usr/bin/env bash
# After a cycle: says whether the state folder may be saved as the newest ("ok=true").
#   the cycle failed (exit 3 or more), or never ran   -> no: the last good cache stays the newest
#   the collector says the state is whole             -> yes
#   the collector says it is not (empty, cut short)   -> no
# $1: the cycle's exit code.
set -u
out="${GITHUB_OUTPUT:-/dev/null}"
code="${1:-}"
no() { echo "state: not saved ($1)"; echo "ok=false" >> "$out"; exit 0; }
case "$code" in
  0|1|2) ;;
  *) no "the cycle exited ${code:-without a code}" ;;
esac
# (a lock left by this run belongs to a machine that will not exist: it is not part of what is saved)
rm -f state/lock
verdict="$(node collect.js --check-state --state state 2>/dev/null)"
checked=$?
if [ "$checked" = "0" ]; then echo "state: whole $verdict"; echo "ok=true" >> "$out"; exit 0; fi
if [ "$checked" = "4" ]; then no "the collector refuses it: $verdict"; fi
# (a collector too old to answer the question: the folder is saved when its db is there, as before)
if [ -s state/collector.db ]; then echo "state: saved unchecked (the collector could not be asked)"; echo "ok=true" >> "$out"; exit 0; fi
no "no collector.db"
