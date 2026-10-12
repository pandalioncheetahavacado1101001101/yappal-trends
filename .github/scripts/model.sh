#!/usr/bin/env bash
# The editor model for one job: a small open model served on this runner itself. No key, no account, nothing leaves the machine.
#
#   .github/scripts/model.sh <model> <deadline: epoch second by which the model must be answering>
#
# Installs the model server (its own install script), serves it as this user from ~/.ollama/models (the folder the Actions
# cache restores), waits until the model answers one small question, reads the editor's unchanging prompt to it, and only then
# writes the collector's settings to $GITHUB_ENV. ANY failure, or the deadline passing, leaves $GITHUB_ENV untouched and exits
# 0: the cycle then runs with no model, every card rule-built, exactly as it did before there was one. Never fails a job.
#
# Outputs (to $GITHUB_OUTPUT): ready=true|false; pulled=started (the model was not in the cache and is being fetched behind the
# cycle: the job's last step saves it) or pulled=true (MODEL_WAIT_FOR_PULL=1: it was fetched before going on).
set -u
MODEL="${1:-}"
DEADLINE="${2:-0}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
ENVF="${GITHUB_ENV:-/dev/null}"
BASE="http://127.0.0.1:11434"
left() { echo $(( DEADLINE - $(date +%s) )); }
none() { echo "model: none this cycle ($1); the cards are rule-built"; echo "ready=false" >> "$OUT"; exit 0; }

[ -n "$MODEL" ] || none "no model named"
[ "$(left)" -gt 60 ] || none "no time left to start one"

# 1. the server (about 20 seconds on a hosted runner)
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL --max-time 150 https://ollama.com/install.sh -o /tmp/ollama-install.sh || none "the install script did not download"
  timeout 200 sh /tmp/ollama-install.sh >/tmp/ollama-install.log 2>&1 || { tail -n 5 /tmp/ollama-install.log; none "the install failed"; }
fi
# (the install script may start a system service of its own, under another user and another models folder: this job serves the
# model itself, from the folder the cache restores)
sudo systemctl stop ollama >/dev/null 2>&1 || true
pkill -x ollama >/dev/null 2>&1 || true
mkdir -p "$HOME/.ollama/models"
OLLAMA_MODELS="$HOME/.ollama/models" OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=30m OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 \
  nohup ollama serve > "$HOME/ollama.log" 2>&1 &
for _ in $(seq 1 30); do curl -sf --max-time 2 "$BASE/api/version" >/dev/null && break; sleep 1; done
curl -sf --max-time 2 "$BASE/api/version" >/dev/null || { tail -n 5 "$HOME/ollama.log"; none "the server did not start"; }

# 2. the model file: from the cache. A job that finds none starts fetching it (several GB) and runs its cycle with NO model: the
# download goes on behind the cycle, and the job's last step saves the file for every later job. So the one slow job is the
# first, and it is never slower than a cycle with no model.
if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qxF "$MODEL"; then
  if [ "${MODEL_WAIT_FOR_PULL:-}" = "1" ]; then
    # (the test workflow has the time to wait for it)
    T=$(( $(left) - 90 ))
    [ "$T" -gt 60 ] || none "not in the cache, and no time left to fetch it"
    timeout "$T" ollama pull "$MODEL" >/tmp/ollama-pull.log 2>&1 || { tail -n 3 /tmp/ollama-pull.log; none "the model did not download in time"; }
    echo "pulled=true" >> "$OUT"
  else
    nohup ollama pull "$MODEL" >/tmp/ollama-pull.log 2>&1 &
    echo "pulled=started" >> "$OUT"
    none "not in the cache: fetching it behind this cycle, for the next one"
  fi
fi

# 3. loaded and answering: one small question, with the switch that stops it thinking aloud
T=$(left)
[ "$T" -gt 30 ] || none "no time left to load it"
REPLY=$(curl -s --max-time "$(( T < 150 ? T : 150 ))" "$BASE/v1/chat/completions" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"reasoning_effort\":\"none\",\"temperature\":0,\"max_tokens\":24,\"response_format\":{\"type\":\"json_object\"},\"messages\":[{\"role\":\"user\",\"content\":\"Reply with JSON only: {\\\"ok\\\": true}\"}]}")
echo "$REPLY" | grep -q '"content":"[^"]' || { echo "$REPLY" | head -c 300; none "it did not answer"; }

# 3b. the editor's unchanging prompt, read once now: the runner keeps the start of a request it has seen, so every card's request
# then costs only its own story (best effort: never a reason to go without the model)
T=$(left)
if [ "$T" -gt 20 ] && [ -f .github/llm/warm.js ]; then timeout "$T" node .github/llm/warm.js "$MODEL" "$(( T < 150 ? T : 150 ))" || true; fi

# 4. the collector's settings: the editor pass on this model, bounded by its own budget and by the job's clock
{
  echo "IDEAS_LLM_BASE_URL=$BASE/v1"
  echo "IDEAS_LLM_MODEL=$MODEL"
  echo "IDEAS_LLM_REASONING=none"
  echo "IDEAS_EDITOR=1"
} >> "$ENVF"
echo "ready=true" >> "$OUT"
echo "model: $MODEL is answering ($(left) s before the deadline)"
