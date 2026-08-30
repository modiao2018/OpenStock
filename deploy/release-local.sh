#!/usr/bin/env bash
# 在开发机（本机）构建生产镜像并推送到服务器发版 —— 服务器全程零构建压力，
# 2C4G 小内存服务器推荐用这个方式，不占服务器 CPU/内存，也不会影响机器上的其他项目。
#
# 用法（在本机仓库根目录执行）：
#   bash deploy/release-local.sh user@服务器IP /opt/happystock
# 也可以把 DEPLOY_HOST / DEPLOY_PATH 写进 deploy/local.env（不进 git），之后直接：
#   bash deploy/release-local.sh
#
# 前提：
#   - 服务器上已完成首次配置（git clone + first-deploy.sh 生成并填好 .env.production）
#   - 本机到服务器的 ssh 免密（ssh-copy-id）
#   - 服务器是 x86 就用默认 PLATFORM=linux/amd64（Apple 芯片本机会走仿真，构建慢些但稳）；
#     ARM 服务器则 PLATFORM=linux/arm64 bash deploy/release-local.sh ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/deploy/_common.sh"

[ -f "$ROOT/deploy/local.env" ] && . "$ROOT/deploy/local.env"
DEPLOY_HOST="${1:-${DEPLOY_HOST:-}}"
DEPLOY_PATH="${2:-${DEPLOY_PATH:-}}"
PLATFORM="${PLATFORM:-linux/amd64}"

[ -n "$DEPLOY_HOST" ] && [ -n "$DEPLOY_PATH" ] \
    || die "用法: bash deploy/release-local.sh user@服务器 /服务器上的部署目录（或写入 deploy/local.env）"
command -v docker >/dev/null || die "本机未安装 docker"

TAG="$(git -C "$ROOT" rev-parse --short HEAD)"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    info "注意：工作区有未提交改动，它们会被打进镜像，但版本号仍是 $TAG"
fi

# 服务器上的 .env.production 是唯一权威配置：从那边取构建参数
info "读取服务器配置（$DEPLOY_HOST:$DEPLOY_PATH/.env.production）"
remote_env() {
    ssh "$DEPLOY_HOST" "grep -E '^$1=' '$DEPLOY_PATH/.env.production' | tail -n1 | cut -d= -f2-" || true
}
FINNHUB_KEY="$(remote_env NEXT_PUBLIC_FINNHUB_API_KEY)"
MONITOR_ON="$(remote_env MONITOR_ENABLED)"
[ -n "$FINNHUB_KEY" ] || die "服务器上的 .env.production 缺 NEXT_PUBLIC_FINNHUB_API_KEY（或 ssh 连不上）"

# ---------- 本机构建 ----------
info "构建 web 镜像（$PLATFORM，版本 $TAG）"
docker build --platform "$PLATFORM" -f "$ROOT/deploy/Dockerfile" --target web \
    --build-arg NEXT_PUBLIC_FINNHUB_API_KEY="$FINNHUB_KEY" \
    -t "$WEB_IMAGE:$TAG" "$ROOT"

SHIP_IMAGES="$WEB_IMAGE:$TAG"
if [ "$MONITOR_ON" = "true" ]; then
    info "构建 monitor 镜像"
    docker build --platform "$PLATFORM" -f "$ROOT/deploy/Dockerfile" --target monitor \
        -t "$MONITOR_IMAGE:$TAG" "$ROOT"
    SHIP_IMAGES="$SHIP_IMAGES $MONITOR_IMAGE:$TAG"
fi

# ---------- 传输镜像 + 同步编排文件 ----------
# 服务器上保留上一次的 images.tar 作为 rsync 增量基底：
# 依赖层/基础镜像层字节不变，每次实际只传变化的代码层（首次全量，之后通常几十 MB）
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
info "打包镜像"
# shellcheck disable=SC2086
docker save $SHIP_IMAGES > "$TMP_DIR/images.tar"
info "增量传输到服务器（首次为全量，之后只传变化的层）"
# 不能把 rsync 直接接管道：失败会被掩盖，导致用旧 tar 发版
rsync -z --partial --stats "$TMP_DIR/images.tar" "$DEPLOY_HOST:$DEPLOY_PATH/deploy/images.tar" > "$TMP_DIR/rsync.log"
grep -E "Total file size|Literal data|Matched data" "$TMP_DIR/rsync.log" || true
ssh "$DEPLOY_HOST" "docker load < '$DEPLOY_PATH/deploy/images.tar'"

info "同步 deploy/ 编排文件"
rsync -az --exclude releases.log --exclude local.env --exclude images.tar \
    "$ROOT/deploy/" "$DEPLOY_HOST:$DEPLOY_PATH/deploy/"

# ---------- 远端发版 ----------
info "在服务器上切换到新版本"
ssh "$DEPLOY_HOST" "cd '$DEPLOY_PATH' && bash deploy/update.sh --tag $TAG"

ok "发版完成：$TAG（服务器未参与构建）"
