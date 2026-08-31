#!/usr/bin/env bash
# 更新发版：在生产服务器的仓库根目录执行
#   bash deploy/update.sh              拉取最新代码 → 构建新镜像 → 滚动重启
#   bash deploy/update.sh --no-pull    跳过 git pull（代码是 rsync/scp 传上来时用）
#   bash deploy/update.sh --tag <tag>  不构建，直接用已加载的镜像发版
#                                      （配合 deploy/release-local.sh 本机构建使用，
#                                       小内存服务器推荐这种方式）
# 出问题想回退：bash deploy/rollback.sh
set -euo pipefail
. "$(dirname "$0")/_common.sh"

check_prereqs
[ -f "$ENV_FILE" ] || die "找不到 ${ENV_FILE}，请先执行 bash deploy/first-deploy.sh"
validate_env

NO_PULL=false
EXPLICIT_TAG=""
while [ $# -gt 0 ]; do
    case "$1" in
        --no-pull) NO_PULL=true ;;
        --tag) EXPLICIT_TAG="${2:-}"; [ -n "$EXPLICIT_TAG" ] || die "--tag 需要指定版本号"; shift ;;
        *) die "未知参数: $1" ;;
    esac
    shift
done

# 记下当前运行的版本，失败时提示回滚目标
prev_tag=""
cid="$(compose ps -q web 2>/dev/null | head -n1 || true)"
if [ -n "$cid" ]; then
    prev_tag="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null | cut -d: -f2 || true)"
fi

if [ -n "$EXPLICIT_TAG" ]; then
    # ---------- 镜像已在本机构建好并 docker load 过，直接切换 ----------
    TAG="$EXPLICIT_TAG"; export TAG
    docker image inspect "$WEB_IMAGE:$TAG" >/dev/null 2>&1 \
        || die "本地没有镜像 $WEB_IMAGE:${TAG}，请先在开发机执行 deploy/release-local.sh"
    if [ "$(get_env MONITOR_ENABLED)" = "true" ]; then
        docker image inspect "$MONITOR_IMAGE:$TAG" >/dev/null 2>&1 \
            || die "MONITOR_ENABLED=true 但缺少镜像 $MONITOR_IMAGE:$TAG"
    fi
    info "使用已加载的镜像 $TAG 发版（跳过构建）"
    compose up -d --no-build
else
    # ---------- 在服务器上构建（吃内存，2C4G 建议改用 release-local.sh） ----------
    if [ "$NO_PULL" = false ]; then
        if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
            info "拉取最新代码"
            git -C "$ROOT" pull --ff-only || die "git pull 失败（本地有改动或分支分叉？可手动处理后用 --no-pull 重试）"
        else
            info "当前目录不是 git 仓库，跳过 git pull"
        fi
    fi

    TAG="$(git_tag)"; export TAG
    if [ -n "$prev_tag" ] && [ "$TAG" = "$prev_tag" ]; then
        info "代码版本没变（${TAG}），仍会重新构建并重启（适用于只改了 .env.production 的情况）"
    fi

    info "构建镜像（版本 ${TAG}）"
    compose build

    info "以新镜像重启服务（数据库不受影响）"
    compose up -d
fi

# 子 shell 调用：失败时不直接退出，先打印回滚提示
if ! ( wait_healthy web 300 ); then
    [ -n "$prev_tag" ] && info "可回滚到上一版本：bash deploy/rollback.sh $prev_tag"
    exit 1
fi
if [ "$(get_env MONITOR_ENABLED)" = "true" ]; then
    wait_healthy monitor 60
fi

record_release "$TAG" "update"
prune_old_images "$TAG"

ok "发版完成：${prev_tag:-（首次）} → $TAG"
echo "查看日志: docker compose -p $PROJECT logs -f web"
