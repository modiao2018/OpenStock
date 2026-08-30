#!/usr/bin/env bash
# 首次部署：在生产服务器的仓库根目录执行
#   bash deploy/first-deploy.sh
# 第一次运行会生成 .env.production 模板并退出；
# 填完必填项后再运行一次即完成建库、构建镜像、启动全部服务。
set -euo pipefail
. "$(dirname "$0")/_common.sh"

check_prereqs

# ---------- 第一步：准备 .env.production ----------
if [ ! -f "$ENV_FILE" ]; then
    info "生成生产配置 $ENV_FILE"
    cp "$ROOT/deploy/.env.production.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    secret="$(rand_hex 32)"
    mongo_pw="$(rand_hex 16)"
    sed -i.bak \
        -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$secret|" \
        -e "s|^MONGO_ROOT_PASSWORD=.*|MONGO_ROOT_PASSWORD=$mongo_pw|" \
        "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    ok "已自动生成 BETTER_AUTH_SECRET 和 MONGO_ROOT_PASSWORD"

    cat <<EOF

接下来请编辑 $ENV_FILE，至少填写：
  - BETTER_AUTH_URL           网站对外访问地址（如 http://服务器IP:3000）
  - NEXT_PUBLIC_FINNHUB_API_KEY  Finnhub 行情 key
需要催化剂监控的话，把 MONITOR_ENABLED 改为 true 并填 BARK_URL、EDGAR_CONTACT。

填完后再次运行：bash deploy/first-deploy.sh
EOF
    exit 0
fi

# ---------- 第二步：校验必填项 ----------
validate_env

if [ "$(get_env MONITOR_ENABLED)" = "true" ]; then
    for key in BARK_URL EDGAR_CONTACT; do
        [ -n "$(get_env "$key")" ] || info "提醒：MONITOR_ENABLED=true 但 $key 为空，监控推送可能不工作"
    done
fi

# ---------- 第三步：构建并启动 ----------
# 小内存服务器（≤4G）建议不要在服务器上构建：填完配置后改在开发机执行
#   bash deploy/release-local.sh user@服务器 /部署目录
# 它会本机构建镜像推上来并完成首次启动，服务器零构建压力。
TAG="$(git_tag)"; export TAG
info "构建镜像（版本 $TAG，首次构建需拉取基础镜像，可能较慢）"
compose build

info "启动服务"
compose up -d

wait_healthy mongodb 120
wait_healthy web 300
if [ "$(get_env MONITOR_ENABLED)" = "true" ]; then
    wait_healthy monitor 60
fi

record_release "$TAG" "first-deploy"

cat <<EOF

部署完成 🎉
  访问地址:   $(get_env BETTER_AUTH_URL)
  查看状态:   docker compose -p $PROJECT ps
  查看日志:   docker compose -p $PROJECT logs -f web
  后续发版:   bash deploy/update.sh

提示：如需 HTTPS/域名，参考 deploy/README.md 的 Nginx 章节。
EOF
