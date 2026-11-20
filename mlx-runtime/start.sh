#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODEL=${MLX_MODEL:-mlx-community/Qwen2.5-7B-Instruct-4bit}
PORT=${MLX_PORT:-8081}
# Default output budget when a request omits max_tokens. The app always sends max_tokens for structured
# calls (8192 unless the task sets maxOutputTokens), so keep this at least that high.

if [ ! -x "$ROOT/.venv/bin/mlx_lm.server" ]; then
  echo "MLX is not installed. Run: python3 -m venv \"$ROOT/.venv\" && \"$ROOT/.venv/bin/python\" -m pip install mlx-lm" >&2
  exit 1
fi

# Keep every downloaded model and cache inside this disposable directory.
export HF_HOME="$ROOT/hf-cache"
export HF_HUB_CACHE="$ROOT/hf-cache/hub"
mkdir -p "$HF_HUB_CACHE"

echo "Starting local MLX chat on http://127.0.0.1:$PORT with $MODEL"
echo "Press Ctrl+C to stop. The Next.js app never starts this process."
exec "$ROOT/.venv/bin/mlx_lm.server" \
  --model "$MODEL" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --prompt-concurrency 1 \
  --decode-concurrency 1 \
  --max-tokens "${MLX_MAX_TOKENS:-8192}"
