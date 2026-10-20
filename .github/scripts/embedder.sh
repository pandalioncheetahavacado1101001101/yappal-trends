#!/usr/bin/env bash
# The embedding model for the enrich pass's stories (enrich.yml, the "stories" job; ios/IDEAS-SUPER.md P8): a small open model
# served on this runner itself. No key, no account, nothing leaves the machine but the model's own download.
#
#   .github/scripts/embedder.sh <model> <deadline: epoch second by which the model must be answering>
#
# Installs the model server (its own install script) unless it is there, serves it as this user, fetches the model (all-minilm:
# 44 MB, about 3 s on a hosted runner: probe-embed, 2026-10-19) and asks it for one vector. ANY failure, or the deadline passing,
# writes ready=false and exits 0: the pass then makes no stories and the desk goes on with the ones it has. Never fails a job.
set -u
MODEL="${1:-}"
DEADLINE="${2:-0}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
BASE="http://127.0.0.1:11434"
left() { echo $(( DEADLINE - $(date +%s) )); }
none() { echo "embedder: none this pass ($1); no stories"; echo "ready=false" >> "$OUT"; exit 0; }

[ -n "$MODEL" ] || none "no model named"
[ "$(left)" -gt 30 ] || none "no time left to start one"

# 1. the server (about a minute on a hosted runner)
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL --max-time 150 https://ollama.com/install.sh -o /tmp/ollama-install.sh || none "the install script did not download"
  timeout "$(( $(left) > 200 ? 200 : $(left) ))" sh /tmp/ollama-install.sh >/tmp/ollama-install.log 2>&1 || { tail -n 5 /tmp/ollama-install.log; none "the install failed"; }
fi
sudo systemctl stop ollama >/dev/null 2>&1 || true
pkill -x ollama >/dev/null 2>&1 || true
mkdir -p "$HOME/.ollama/models"
OLLAMA_MODELS="$HOME/.ollama/models" OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=30m OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 \
  nohup ollama serve > "$HOME/ollama.log" 2>&1 &
for _ in $(seq 1 30); do curl -sf --max-time 2 "$BASE/api/version" >/dev/null && break; sleep 1; done
curl -sf --max-time 2 "$BASE/api/version" >/dev/null || { tail -n 5 "$HOME/ollama.log"; none "the server did not start"; }

# 2. the model (small: fetched every pass, no cache entry of its own)
if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qE "^${MODEL}(:latest)?$"; then
  T=$(left)
  [ "$T" -gt 20 ] || none "no time left to fetch it"
  timeout "$(( T < 180 ? T : 180 ))" ollama pull "$MODEL" >/tmp/ollama-pull.log 2>&1 || { tail -n 3 /tmp/ollama-pull.log; none "the model did not download in time"; }
fi

# 3. answering: one vector
T=$(left)
[ "$T" -gt 5 ] || none "no time left to load it"
REPLY=$(curl -s --max-time "$(( T < 60 ? T : 60 ))" "$BASE/api/embed" -H 'content-type: application/json' -d "{\"model\":\"$MODEL\",\"input\":[\"ready\"]}")
echo "$REPLY" | grep -q '"embeddings":\[\[' || { echo "$REPLY" | head -c 200; none "it gave no vector"; }
echo "ready=true" >> "$OUT"
echo "embedder: $MODEL is answering ($(left) s before the deadline)"
