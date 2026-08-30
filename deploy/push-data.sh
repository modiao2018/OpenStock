#!/usr/bin/env bash
# 把本地开发环境的 MongoDB 数据（openstock 库，含用户账号/自选股/催化剂数据）
# 迁移到生产服务器。在开发机仓库根目录执行：
#   bash deploy/push-data.sh [user@服务器] [/部署目录] [--overwrite]
# 服务器库里已有数据时会拒绝执行，确认要覆盖才加 --overwrite。
set -euo pipefail
. "$(dirname "$0")/_common.sh"

[ -f "$ROOT/deploy/local.env" ] && . "$ROOT/deploy/local.env"
OVERWRITE=false
ARGS=()
for a in "$@"; do
    case "$a" in
        --overwrite) OVERWRITE=true ;;
        *) ARGS+=("$a") ;;
    esac
done
DEPLOY_HOST="${ARGS[0]:-${DEPLOY_HOST:-}}"
DEPLOY_PATH="${ARGS[1]:-${DEPLOY_PATH:-}}"
[ -n "$DEPLOY_HOST" ] && [ -n "$DEPLOY_PATH" ] \
    || die "用法: bash deploy/push-data.sh user@服务器 /部署目录 [--overwrite]（或写入 deploy/local.env）"

# ---------- 本地侧检查 ----------
LOCAL_URI="$(grep -E '^MONGODB_URI=' "$ROOT/.env" | tail -n1 | cut -d= -f2- || true)"
[ -n "$LOCAL_URI" ] || die "本地 .env 里没有 MONGODB_URI"
[ -n "$(docker ps -qf name='^mongodb$')" ] \
    || die "本地 mongodb 容器没在运行，先执行: docker compose up -d mongodb"

# ---------- 服务器侧检查 ----------
CID="$(ssh "$DEPLOY_HOST" "docker ps -qf label=com.docker.compose.project=$PROJECT -f label=com.docker.compose.service=mongodb" | head -n1)"
[ -n "$CID" ] || die "服务器上 mongodb 容器没在运行，请先完成首次部署"
REMOTE_PW="$(ssh "$DEPLOY_HOST" "grep -E '^MONGO_ROOT_PASSWORD=' '$DEPLOY_PATH/.env.production' | tail -n1 | cut -d= -f2-")"
[ -n "$REMOTE_PW" ] || die "读不到服务器 .env.production 的 MONGO_ROOT_PASSWORD"

remote_mongo() {
    ssh "$DEPLOY_HOST" "docker exec ${2:-} $CID $1 -u root -p '$REMOTE_PW' --authenticationDatabase admin ${3:-}"
}

count="$(remote_mongo "mongosh --quiet --eval 'db.getSiblingDB(\"openstock\").getCollectionNames().length'" )"
if [ "${count:-0}" -gt 0 ] && [ "$OVERWRITE" = false ]; then
    die "服务器 openstock 库已有 $count 个集合，覆盖会丢失服务器数据！确认无误请加 --overwrite"
fi

# ---------- 流式迁移：本地 dump 直接管道到服务器 restore，不落中间文件 ----------
info "开始迁移（本地 openstock 库 → 服务器，服务器同名库会被覆盖）"
docker exec mongodb mongodump --uri "$LOCAL_URI" --archive --gzip \
    | ssh "$DEPLOY_HOST" "docker exec -i $CID mongorestore --archive --gzip --drop --nsInclude 'openstock.*' -u root -p '$REMOTE_PW' --authenticationDatabase admin"

after="$(remote_mongo "mongosh --quiet --eval 'db.getSiblingDB(\"openstock\").getCollectionNames().length'" )"
ok "迁移完成：服务器 openstock 库现有 $after 个集合"
