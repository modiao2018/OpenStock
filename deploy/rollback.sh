#!/usr/bin/env bash
# 回滚到之前的镜像版本（不重新构建，秒级切换；数据库数据不受影响）
#   bash deploy/rollback.sh          回滚到上一个发版记录
#   bash deploy/rollback.sh <tag>    回滚到指定版本（tag 见 deploy/releases.log）
set -euo pipefail
. "$(dirname "$0")/_common.sh"

check_prereqs
[ -f "$ENV_FILE" ] || die "找不到 $ENV_FILE"

target="${1:-}"
if [ -z "$target" ]; then
    [ -f "$RELEASES_LOG" ] || die "没有发版记录（${RELEASES_LOG}），请手动指定 tag"
    # 取最近一条与当前不同的发版记录（倒数第二个版本）
    current="$(tail -n1 "$RELEASES_LOG" | awk '{print $3}')"
    target="$(awk '{print $3}' "$RELEASES_LOG" | grep -v "^$current\$" | tail -n1 || true)"
    [ -n "$target" ] || die "发版记录里找不到可回滚的旧版本，请手动指定 tag"
fi

docker image inspect "$WEB_IMAGE:$target" >/dev/null 2>&1 \
    || die "本地没有镜像 $WEB_IMAGE:${target}（可能已被清理），只能重新构建：git checkout <版本> && bash deploy/update.sh --no-pull"
if [ "$(get_env MONITOR_ENABLED)" = "true" ]; then
    docker image inspect "$MONITOR_IMAGE:$target" >/dev/null 2>&1 \
        || die "MONITOR_ENABLED=true 但缺少镜像 $MONITOR_IMAGE:$target"
fi

info "回滚到版本 $target"
TAG="$target"; export TAG
compose up -d --no-build

wait_healthy web 300
record_release "$target" "rollback"
ok "已回滚到 $target"
echo "注意：镜像回滚了，但工作区代码还是新的；下次 update.sh 会再次发布新代码。"
