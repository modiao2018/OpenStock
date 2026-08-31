#!/usr/bin/env bash
# 首次部署一条龙（在开发机执行，服务器只需装好 docker，连 git clone 都不用）：
#   1. 上传 deploy/ 编排文件
#   2. 生成服务器 .env.production —— API key 全部沿用本地 .env，
#      数据库密码自动生成，BETTER_AUTH_URL 默认 http://152.53.176.254
#   3. 本机构建镜像 → 推送 → 启动全部服务（调用 release-local.sh）
#   4. 把本地开发库数据迁移到服务器（调用 push-data.sh，服务器库非空会自动拒绝）
#
# 用法: bash deploy/bootstrap-remote.sh user@服务器 /opt/happystock
#      （或把 DEPLOY_HOST/DEPLOY_PATH 写进 deploy/local.env 后不带参数执行；
#        站点地址可用 SITE_URL=... 覆盖默认值）
# 前提: 服务器装好 Docker + Compose v2；本机 ssh 免密登录服务器
set -euo pipefail
. "$(dirname "$0")/_common.sh"

[ -f "$ROOT/deploy/local.env" ] && . "$ROOT/deploy/local.env"
DEPLOY_HOST="${1:-${DEPLOY_HOST:-}}"
DEPLOY_PATH="${2:-${DEPLOY_PATH:-}}"
SITE_URL="${SITE_URL:-http://152.53.176.254}"
[ -n "$DEPLOY_HOST" ] && [ -n "$DEPLOY_PATH" ] \
    || die "用法: bash deploy/bootstrap-remote.sh user@服务器 /部署目录（或写入 deploy/local.env）"

# ---------- 前置检查 ----------
info "检查服务器环境"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_HOST" true \
    || die "ssh 连不上 ${DEPLOY_HOST}（需要免密登录，先 ssh-copy-id）"
ssh "$DEPLOY_HOST" "docker info >/dev/null 2>&1" \
    || die "服务器 docker 不可用（未安装 / 未启动 / 当前用户无权限）"
ssh "$DEPLOY_HOST" "docker compose version >/dev/null 2>&1" \
    || die "服务器缺少 docker compose v2 插件"
[ -f "$ROOT/.env" ] || die "本地 .env 不存在，没法沿用配置"

ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH/deploy'"
info "上传 deploy/ 编排文件"
rsync -az --exclude releases.log --exclude local.env --exclude images.tar \
    "$ROOT/deploy/" "$DEPLOY_HOST:$DEPLOY_PATH/deploy/"

# ---------- 生成并上传 .env.production ----------
if ssh "$DEPLOY_HOST" "test -f '$DEPLOY_PATH/.env.production'"; then
    info "服务器已有 .env.production，跳过生成（要重新生成请先删除服务器上的该文件）"
else
    info "生成服务器配置（API key 沿用本地 .env）"
    local_env() { grep -E "^$1=" "$ROOT/.env" | tail -n1 | cut -d= -f2- || true; }

    secret="$(local_env BETTER_AUTH_SECRET)"
    [ "${#secret}" -ge 32 ] || secret="$(rand_hex 32)"

    tmp_env="$(mktemp)"
    copied=""
    while IFS= read -r line; do
        case "$line" in
            [A-Z_]*=*)
                key="${line%%=*}"
                case "$key" in
                    MONGO_ROOT_PASSWORD) val="$(rand_hex 16)" ;;
                    BETTER_AUTH_SECRET)  val="$secret" ;;
                    BETTER_AUTH_URL)     val="$SITE_URL" ;;
                    WEB_PORT|WEB_BIND)   val="${line#*=}" ;;   # 用模板默认值
                    MONITOR_ENABLED)     val="true" ;;         # 本地在跑监控，服务器也开
                    *)
                        val="$(local_env "$key")"
                        if [ -n "$val" ]; then copied="$copied $key"; else val="${line#*=}"; fi
                        ;;
                esac
                printf '%s=%s\n' "$key" "$val"
                ;;
            *) printf '%s\n' "$line" ;;
        esac
    done < "$ROOT/deploy/.env.production.example" > "$tmp_env"

    scp -q "$tmp_env" "$DEPLOY_HOST:$DEPLOY_PATH/.env.production"
    ssh "$DEPLOY_HOST" "chmod 600 '$DEPLOY_PATH/.env.production'"
    rm -f "$tmp_env"
    ok "配置已上传；沿用了本地的:${copied:- （无）}"
    echo "   BETTER_AUTH_URL=${SITE_URL}，MONGO_ROOT_PASSWORD/BETTER_AUTH_SECRET 已自动生成"
fi

# ---------- 构建、推送、启动 ----------
bash "$ROOT/deploy/release-local.sh" "$DEPLOY_HOST" "$DEPLOY_PATH"

# ---------- 迁移开发数据 ----------
bash "$ROOT/deploy/push-data.sh" "$DEPLOY_HOST" "$DEPLOY_PATH"

cat <<EOF

首次部署完成 🎉  还差两步手工操作：
  1. 接上 nginx：按 deploy/nginx.conf.example 顶部的 5 步在服务器上执行，
     然后浏览器打开 $SITE_URL
  2. 服务器已在跑 catalyst-monitor，本机的 launchd 版会导致 Bark 重复推送，
     建议停掉：sh scripts/install-monitor-daemon.sh off
EOF
