#!/bin/sh
# Starts the Next.js standalone server and, when a tunnel token is present, the
# Cloudflare Tunnel connector that carries prologue.dev traffic.
set -eu

echo "[entrypoint] starting Next.js server"
node server.js &
NODE_PID=$!

TUNNEL_PID=""
if [ -n "${TUNNEL_TOKEN:-}" ]; then
  echo "[entrypoint] starting cloudflared tunnel connector"
  cloudflared tunnel --no-autoupdate --loglevel info run --token "${TUNNEL_TOKEN}" &
  TUNNEL_PID=$!
else
  echo "[entrypoint] TUNNEL_TOKEN not set; running without Cloudflare tunnel"
fi

term() {
  echo "[entrypoint] shutting down"
  kill -TERM "$NODE_PID" 2>/dev/null || true
  if [ -n "$TUNNEL_PID" ]; then kill -TERM "$TUNNEL_PID" 2>/dev/null || true; fi
}
trap term INT TERM

wait "$NODE_PID"
