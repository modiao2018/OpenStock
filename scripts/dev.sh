#!/bin/sh
# Dev entrypoint: brings MongoDB (docker compose) up before Next.js,
# runs the catalyst-monitor daemon alongside, and stops both again
# when the dev server exits.
set -e

PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."

if command -v colima >/dev/null 2>&1 && ! colima status >/dev/null 2>&1; then
    echo "[dev] starting colima..."
    colima start
fi

echo "[dev] starting mongodb container..."
docker compose up -d --wait mongodb

echo "[dev] starting catalyst-monitor daemon (log: /tmp/catalyst-monitor.log)..."
# caffeinate -i：dev 运行期间阻止 Mac 闲置休眠，保证美股盘中（北京时间夜里）监控不中断
caffeinate -i npx tsx catalyst-monitor/src/daemon.ts >> /tmp/catalyst-monitor.log 2>&1 &
MONITOR_PID=$!

cleanup() {
    echo "[dev] stopping catalyst-monitor daemon..."
    kill "$MONITOR_PID" 2>/dev/null || true
    echo "[dev] stopping mongodb container..."
    docker compose stop mongodb
}
trap cleanup EXIT INT TERM

next dev --turbopack
