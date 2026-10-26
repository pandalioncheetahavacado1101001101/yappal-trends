#!/usr/bin/env bash
# The editor model for one job: a small open model served on this runner itself. No key, no account, nothing leaves the machine.
#
#   .github/scripts/model.sh <model> <deadline: epoch second by which the model must be answering>
#
# Installs the model server (its own install script; or waits for the one the job's first step started behind the restores,
# enrich.yml), serves it as this user from ~/.ollama/models (the folder the Actions cache restores), waits until the model answers
# one small question (MODEL_WARM=1: and reads the editor's unchanging prompt to it), and only then writes the collector's settings to
# $GITHUB_ENV, printing the seconds each step took since it began (the shard's start, counts and seconds only). ANY
# failure, or the deadline passing, leaves $GITHUB_ENV untouched and exits 0: the job then runs with no model, nothing asked. Never
# fails a job.
#
# How it serves (environment; enrich.yml sets them from the repository's variables, every one optional):
#   MODEL_PARALLEL  stories served side by side (1): OLLAMA_NUM_PARALLEL. Decode on a CPU is bound by memory bandwidth, so the
#                   weights read once a step serve every sequence in the batch; with more than one, OLLAMA_MULTIUSER_CACHE=1, so a
#                   new sequence takes the editor's prompt, read once, from another's cache instead of reading it again
#   MODEL_NATIVE    1 (the default): Ollama's own API (lib/llm.js IDEAS_LLM_OLLAMA), the only one that says where a call's time
#                   went and takes the load-time options below on each request; 0: the OpenAI-style endpoint, as before
#   MODEL_CTX       the context a sequence holds (6144): the editor's whole prompt is ~2.3 to 2.9K tokens of system and examples, a
#                   story up to ~0.7K, a refused card sent back ~0.4K, a reply up to 900; 4096 cut the longest retries short
#   MODEL_THREADS   threads (nproc: every core the job has)
#   MODEL_FLASH     1 (the default): OLLAMA_FLASH_ATTENTION; MODEL_KV: OLLAMA_KV_CACHE_TYPE (unset: f16; q8_0 halves the KV reads,
#                   ~3% of a step at this context, and is left to a variable because it changes the numbers a little)
#   MODEL_WARM      0 (the default since 2026-10-27): no warm read. Measured on the runner with one story at a time, every card's call
#                   read its whole prompt again (~3,450 tokens: the model's sliding-window layers keep no long prefix), so the warm
#                   read only cost its ~15 s of every shard's start. 1: read the editor's prompt once before the first card, as before
#   MODEL_PULL      1 (the default): a model the cache did not hold is fetched; 0: never from the network (a shard that is not
#                   shard 0, or a restore that failed rather than missed: enrich.yml)
#
# Outputs (to $GITHUB_OUTPUT): ready=true|false; pulled=started (the model was not in the cache and is being fetched behind the
# cycle: the job's last step saves it) or pulled=true (MODEL_WAIT_FOR_PULL=1: it was fetched before going on).
set -u
MODEL="${1:-}"
DEADLINE="${2:-0}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
ENVF="${GITHUB_ENV:-/dev/null}"
BASE="http://127.0.0.1:11434"
# (as lib/editor/cards.js lanesOf reads the same number: a whole number, 4 at most; one that does not read is the shards' 3)
PARALLEL="${MODEL_PARALLEL:-1}"; PARALLEL="${PARALLEL%%.*}"; [[ "$PARALLEL" =~ ^[0-9]+$ ]] && [ "$PARALLEL" -ge 1 ] || PARALLEL=3; [ "$PARALLEL" -le 4 ] || PARALLEL=4
NATIVE="${MODEL_NATIVE:-1}"; [ "$NATIVE" = "0" ] || NATIVE=1
CTX="${MODEL_CTX:-6144}"; [[ "$CTX" =~ ^[0-9]+$ ]] && [ "$CTX" -ge 2048 ] && [ "$CTX" -le 32768 ] || CTX=6144
LOGICAL=$(nproc 2>/dev/null || echo 4)
THREADS="${MODEL_THREADS:-$LOGICAL}"; [[ "$THREADS" =~ ^[0-9]+$ ]] && [ "$THREADS" -ge 1 ] && [ "$THREADS" -le 64 ] || THREADS="$LOGICAL"
FLASH="${MODEL_FLASH:-1}"; [ "$FLASH" = "0" ] || FLASH=1
KV="${MODEL_KV:-}"; [[ "$KV" =~ ^(f16|q8_0|q4_0)$ ]] || KV=""
PULL="${MODEL_PULL:-1}"
WARM="${MODEL_WARM:-0}"; [ "$WARM" = "1" ] || WARM=0
BEGAN=$(date +%s)
left() { echo $(( DEADLINE - $(date +%s) )); }
# (the seconds since this script began, for the job's log: where a shard's start goes)
took() { echo "model: $1 $(( $(date +%s) - BEGAN )) s in"; }
none() { echo "model: none this cycle ($1); the cards are rule-built"; echo "ready=false" >> "$OUT"; exit 0; }

[ -n "$MODEL" ] || none "no model named"
[ "$(left)" -gt 60 ] || none "no time left to start one"

# 1. the server (about 20 seconds to fetch on a hosted runner, and as long to unpack). The enrich shards start fetching it in their
# first step, behind the state, the cards and the model's restore: wait for that one to end, then use it, or install here.
if [ -f /tmp/ollama-install.pid ]; then
  while kill -0 "$(cat /tmp/ollama-install.pid 2>/dev/null)" 2>/dev/null && [ "$(left)" -gt 60 ]; do sleep 1; done
  echo "model: the server fetched behind the restores ($( [ -f /tmp/ollama-install.code ] && echo "exit $(cat /tmp/ollama-install.code)" || echo "unfinished"))"
  took "the install waited for"
fi
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL --max-time 150 https://ollama.com/install.sh -o /tmp/ollama-install.sh || none "the install script did not download"
  timeout 200 sh /tmp/ollama-install.sh >/tmp/ollama-install.log 2>&1 || { tail -n 5 /tmp/ollama-install.log; none "the install failed"; }
fi
# (the install script may start a system service of its own, under another user and another models folder: this job serves the
# model itself, from the folder the cache restores)
sudo systemctl stop ollama >/dev/null 2>&1 || true
pkill -x ollama >/dev/null 2>&1 || true
mkdir -p "$HOME/.ollama/models"
SERVE=("OLLAMA_MODELS=$HOME/.ollama/models" "OLLAMA_HOST=127.0.0.1:11434" "OLLAMA_KEEP_ALIVE=30m" "OLLAMA_NUM_PARALLEL=$PARALLEL" "OLLAMA_MAX_LOADED_MODELS=1"
  "OLLAMA_CONTEXT_LENGTH=$CTX" "OLLAMA_FLASH_ATTENTION=$FLASH")
[ -n "$KV" ] && SERVE+=("OLLAMA_KV_CACHE_TYPE=$KV")
[ "$PARALLEL" -gt 1 ] && SERVE+=("OLLAMA_MULTIUSER_CACHE=1")
nohup env "${SERVE[@]}" ollama serve > "$HOME/ollama.log" 2>&1 &
for _ in $(seq 1 30); do curl -sf --max-time 2 "$BASE/api/version" >/dev/null && break; sleep 1; done
curl -sf --max-time 2 "$BASE/api/version" >/dev/null || { tail -n 5 "$HOME/ollama.log"; none "the server did not start"; }
PHYSICAL=$(lscpu -p=core,socket 2>/dev/null | grep -v '^#' | sort -u | wc -l | tr -d ' '); [ "${PHYSICAL:-0}" -gt 0 ] 2>/dev/null || PHYSICAL="?"
took "the server answering"
echo "model: serving $PARALLEL at once, context $CTX a sequence, $THREADS threads ($PHYSICAL physical cores, $LOGICAL logical), flash attention $FLASH, KV cache ${KV:-f16}, $( [ "$NATIVE" = 1 ] && echo "Ollama's own API" || echo "the OpenAI-style API")"

# 2. the model file: from the cache. A job that finds none starts fetching it (several GB) and runs its cycle with NO model: the
# download goes on behind the cycle, and the job's last step saves the file for every later job. So the one slow job is the
# first, and it is never slower than a cycle with no model. MODEL_PULL=0: never fetched here (another job does).
if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qxF "$MODEL"; then
  [ "$PULL" = "1" ] || none "not in the cache, and this job does not fetch it"
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

# 3. loaded and answering: one small question, with the switch that stops it thinking aloud. On Ollama's own API with the very
# load-time options every card's request carries (a request that differs in them makes the server load the model again)
T=$(left)
[ "$T" -gt 30 ] || none "no time left to load it"
if [ "$NATIVE" = "1" ]; then
  REPLY=$(curl -s --max-time "$(( T < 150 ? T : 150 ))" "$BASE/api/chat" -H 'content-type: application/json' \
    -d "{\"model\":\"$MODEL\",\"stream\":false,\"think\":false,\"format\":\"json\",\"keep_alive\":\"30m\",\"options\":{\"temperature\":0,\"top_p\":1,\"num_predict\":24,\"num_ctx\":$CTX,\"num_thread\":$THREADS},\"messages\":[{\"role\":\"user\",\"content\":\"Reply with JSON only: {\\\"ok\\\": true}\"}]}")
else
  REPLY=$(curl -s --max-time "$(( T < 150 ? T : 150 ))" "$BASE/v1/chat/completions" -H 'content-type: application/json' \
    -d "{\"model\":\"$MODEL\",\"reasoning_effort\":\"none\",\"temperature\":0,\"max_tokens\":24,\"response_format\":{\"type\":\"json_object\"},\"messages\":[{\"role\":\"user\",\"content\":\"Reply with JSON only: {\\\"ok\\\": true}\"}]}")
fi
echo "$REPLY" | grep -q '"content":"[^"]' || { echo "$REPLY" | head -c 300; none "it did not answer"; }
took "the model loaded and answering"

# the collector's settings: the editor pass on this model, bounded by its own budget and by the job's clock
SETTINGS=("IDEAS_LLM_BASE_URL=$BASE/v1" "IDEAS_LLM_MODEL=$MODEL" "IDEAS_LLM_REASONING=none" "IDEAS_EDITOR=1")
[ "$NATIVE" = "1" ] && SETTINGS+=("IDEAS_LLM_OLLAMA=1" "IDEAS_LLM_NUM_CTX=$CTX" "IDEAS_LLM_NUM_THREAD=$THREADS" "IDEAS_LLM_KEEP_ALIVE=30m")

# 3b. the editor's unchanging prompt, read once now: the server keeps the start of a request it has seen, so every card's request
# then costs only its own story (best effort: never a reason to go without the model). Through the very settings the cards use
T=$(left)
if [ "$WARM" = "1" ] && [ "$T" -gt 20 ]; then
  if [ "$NATIVE" = "1" ] && [ -f .github/scripts/enrich.js ]; then timeout "$T" env "${SETTINGS[@]}" node .github/scripts/enrich.js warm --seconds "$(( T < 150 ? T : 150 ))" || true
  elif [ -f .github/llm/warm.js ]; then timeout "$T" node .github/llm/warm.js "$MODEL" "$(( T < 150 ? T : 150 ))" || true; fi
  took "the prompt read"
fi

# 4. the settings, only now that the model answers
printf '%s\n' "${SETTINGS[@]}" >> "$ENVF"
echo "ready=true" >> "$OUT"
echo "model: $MODEL is answering ($(left) s before the deadline)"
