#!/usr/bin/env bash
# deploy 脚本共用函数，不要直接执行本文件
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.production"
COMPOSE_FILE="$ROOT/deploy/docker-compose.prod.yml"
PROJECT="happystock"
WEB_IMAGE="happystock-web"
MONITOR_IMAGE="happystock-monitor"
RELEASES_LOG="$ROOT/deploy/releases.log"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# 从 .env.production 读取某个变量的值（取最后一次出现的赋值）
get_env() {
    [ -f "$ENV_FILE" ] || return 0
    grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true
}

check_prereqs() {
    command -v docker >/dev/null 2>&1 || die "未安装 docker，请先安装：https://docs.docker.com/engine/install/"
    docker info >/dev/null 2>&1 || die "docker 守护进程未运行（或当前用户无权限，试试加入 docker 用户组）"
    docker compose version >/dev/null 2>&1 || die "缺少 docker compose v2 插件"
}

# 是否启用催化剂监控（compose profile）
profile_args() {
    if [ "$(get_env MONITOR_ENABLED)" = "true" ]; then
        echo "--profile monitor"
    fi
}

# 统一的 compose 入口：固定项目名、项目目录、env 文件和镜像 TAG
compose() {
    # shellcheck disable=SC2046
    TAG="${TAG:-latest}" docker compose \
        -p "$PROJECT" \
        --project-directory "$ROOT" \
        --env-file "$ENV_FILE" \
        -f "$COMPOSE_FILE" \
        $(profile_args) \
        "$@"
}

# 当前代码版本号，用作镜像 tag
git_tag() {
    git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "latest"
}

rand_hex() {
    openssl rand -hex "$1" 2>/dev/null \
        || od -vN "$1" -An -tx1 /dev/urandom | tr -d ' \n'
}

# 等待服务的容器 healthcheck 变为 healthy
wait_healthy() {
    local svc="$1" timeout="${2:-180}" waited=0 cid status
    info "等待 $svc 就绪（最长 ${timeout}s）..."
    while [ "$waited" -lt "$timeout" ]; do
        cid="$(compose ps -q "$svc" | head -n1)"
        if [ -n "$cid" ]; then
            status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
            case "$status" in
                healthy) ok "$svc 已就绪"; return 0 ;;
                running) ok "$svc 运行中（无健康检查）"; return 0 ;;
                exited|dead)
                    printf '\n最近日志：\n'; compose logs --tail 50 "$svc" || true
                    die "$svc 容器已退出，请根据上方日志排查" ;;
            esac
        fi
        sleep 5; waited=$((waited + 5))
    done
    printf '\n最近日志：\n'; compose logs --tail 50 "$svc" || true
    die "$svc 在 ${timeout}s 内未就绪，请根据上方日志排查"
}

record_release() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1 $2" >> "$RELEASES_LOG"
}

# 校验 .env.production 的必填项
validate_env() {
    local missing="" key
    for key in MONGO_ROOT_PASSWORD BETTER_AUTH_SECRET BETTER_AUTH_URL NEXT_PUBLIC_FINNHUB_API_KEY; do
        [ -n "$(get_env "$key")" ] || missing="$missing $key"
    done
    [ -z "$missing" ] || die "以下必填项还没填，请编辑 $ENV_FILE：$missing"
}

# 只保留最近 5 个版本的镜像 tag，避免磁盘被旧镜像塞满（小服务器磁盘金贵）
prune_old_images() {
    local keep=5 current="$1" image
    for image in "$WEB_IMAGE" "$MONITOR_IMAGE"; do
        docker images "$image" --format '{{.Tag}} {{.CreatedAt}}' \
            | grep -v '^latest ' | sort -rk2 | awk '{print $1}' \
            | tail -n +$((keep + 1)) \
            | while read -r tag; do
                [ "$tag" = "$current" ] && continue
                docker rmi "$image:$tag" >/dev/null 2>&1 || true
            done
    done
    docker image prune -f >/dev/null 2>&1 || true
}
