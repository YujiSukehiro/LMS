#!/bin/sh
set -eu

PORT=${MLX_PORT:-8081}
if curl --silent --fail --max-time 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null; then
  echo "MLX is responding on http://127.0.0.1:$PORT."
else
  echo "MLX is not responding on port $PORT."
  exit 1
fi
