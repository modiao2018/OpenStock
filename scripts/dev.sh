#!/bin/sh
# Dev entrypoint: brings MongoDB (docker compose) up before Next.js and
# stops the container again when the dev server exits.
set -e

PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."

if command -v colima >/dev/null 2>&1 && ! colima status >/dev/null 2>&1; then
    echo "[dev] starting colima..."
    colima start
fi

echo "[dev] starting mongodb container..."
docker compose up -d --wait mongodb

cleanup() {
    echo "[dev] stopping mongodb container..."
    docker compose stop mongodb
}
trap cleanup EXIT INT TERM

next dev --turbopack
