#!/bin/sh
set -eu

# Select the disposable loopback MLX profile without reading or changing .env.local.
# Explicit caller values win, so a different local model or port can be tested safely.
AI_PROVIDER=openai_compatible
OPENAI_COMPATIBLE_BASE_URL=${OPENAI_COMPATIBLE_BASE_URL:-http://127.0.0.1:8081}
OPENAI_COMPATIBLE_HEAVY_MODEL=${OPENAI_COMPATIBLE_HEAVY_MODEL:-mlx-community/Qwen2.5-7B-Instruct-4bit}
OPENAI_COMPATIBLE_FAST_MODEL=${OPENAI_COMPATIBLE_FAST_MODEL:-$OPENAI_COMPATIBLE_HEAVY_MODEL}
LOCAL_RUNTIME_LABEL=${LOCAL_RUNTIME_LABEL:-MLX}
export AI_PROVIDER OPENAI_COMPATIBLE_BASE_URL OPENAI_COMPATIBLE_HEAVY_MODEL OPENAI_COMPATIBLE_FAST_MODEL LOCAL_RUNTIME_LABEL

if [ "$#" -eq 0 ]; then
  echo "Usage: sh scripts/with-mlx-env.sh <command> [arguments ...]" >&2
  exit 2
fi

exec "$@"
