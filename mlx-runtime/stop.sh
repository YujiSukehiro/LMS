#!/bin/sh
set -eu

PORT=${MLX_PORT:-8081}
PIDS=$(pgrep -f "mlx_lm.server.*--port $PORT" || true)
if [ -z "$PIDS" ]; then
  echo "No MLX server is running on port $PORT."
  exit 0
fi

echo "Stopping local MLX server on port $PORT."
kill $PIDS
