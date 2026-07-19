#!/usr/bin/env bash
# Pull the local models Atlas uses for its "Ask" chat + embeddings, and verify
# the Ollama server is reachable. Safe to re-run.
set -euo pipefail

BASE_URL="${OLLAMA_HOST:-http://localhost:11434}"
CHAT_MODEL="${ATLAS_CHAT_MODEL:-llama3.1:8b}"
EMBED_MODEL="${ATLAS_EMBED_MODEL:-nomic-embed-text}"

echo "Atlas local-AI setup"
echo "  server: $BASE_URL"
echo "  chat:   $CHAT_MODEL"
echo "  embed:  $EMBED_MODEL"
echo

if ! command -v ollama >/dev/null 2>&1; then
  echo "error: 'ollama' not found. Install it first: https://ollama.com/download" >&2
  exit 1
fi

if ! curl -fsS "$BASE_URL/api/tags" >/dev/null 2>&1; then
  echo "error: Ollama server not reachable at $BASE_URL." >&2
  echo "       Start the Ollama app (or run 'ollama serve') and try again." >&2
  exit 1
fi

echo "Pulling models (skips layers you already have)…"
ollama pull "$CHAT_MODEL"
ollama pull "$EMBED_MODEL"

echo
echo "Done. Start the app with 'npm run dev' and open http://localhost:5173 → Ask."
echo "The status dot should turn green (Local · Ollama)."
