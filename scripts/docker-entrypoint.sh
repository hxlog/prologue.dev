#!/bin/sh
# Starts the Next.js standalone server, waits for it to answer locally, then
# starts the Cloudflare Tunnel connector. A small watchdog is installed if curl
# is available: a hung next-server (health check failing while cloudflared keeps
# the tunnel open) is restarted instead of silently serving 502s through
# Cloudflare.
set -eu

PORT="${PORT:-8080}"
echo "[entrypoint] starting Next.js server on ${PORT}"
node server.js &
NODE_PID=$!

wait_for_server() {
  i=0
  while [ "$i" -lt 90 ]; do
    if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:${PORT}/robots.txt" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "[entrypoint] Next.js did not answer within 90s"
  return 1
}

TUNNEL_PID=""
WATCHDOG_PID=""
start_tunnel() {
  if [ -n "${TUNNEL_TOKEN:-}" ]; then
    echo "[entrypoint] starting cloudflared tunnel connector"
    cloudflared tunnel --no-autoupdate --loglevel info run --token "${TUNNEL_TOKEN}" &
    TUNNEL_PID=$!
  else
    echo "[entrypoint] TUNNEL_TOKEN not set; running without Cloudflare tunnel"
  fi
}

if wait_for_server; then
  start_tunnel
else
  echo "[entrypoint] starting tunnel anyway; watchdog will restart the container if the server stays down"
  start_tunnel
fi

# Restart the container if the local server stops answering. Three consecutive
# failures are required so a slow image/OG render cannot trigger a restart.
(
  sleep 90
  fails=0
  while kill -0 "$NODE_PID" 2>/dev/null; do
    if curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${PORT}/robots.txt" 2>/dev/null; then
      fails=0
    else
      fails=$((fails + 1))
      echo "[watchdog] local health check failed (${fails}/3)"
    fi
    if [ "$fails" -ge 3 ]; then
      echo "[watchdog] restarting the container because next-server is unresponsive"
      kill -TERM "$NODE_PID" 2>/dev/null || true
      exit 0
    fi
    sleep 30
  done
) &
WATCHDOG_PID=$!

term() {
  echo "[entrypoint] shutting down"
  if [ -n "$WATCHDOG_PID" ]; then kill -TERM "$WATCHDOG_PID" 2>/dev/null || true; fi
  if [ -n "$TUNNEL_PID" ]; then kill -TERM "$TUNNEL_PID" 2>/dev/null || true; fi
  kill -TERM "$NODE_PID" 2>/dev/null || true
}
trap term INT TERM

wait "$NODE_PID"
