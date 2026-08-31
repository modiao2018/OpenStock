# HappyStock 生产部署指南

基于 Docker Compose，**针对小内存服务器（2C4G）且与其他项目共存的场景优化**。三个服务：

| 服务 | 说明 | 内存上限 | 常驻占用（约） |
|---|---|---|---|
| web | Next.js 网站（standalone 精简运行时） | 768M | 150–300M |
| mongodb | 数据库（缓存封顶 256M，仅容器网络内可达） | 512M | 300–450M |
| monitor | 催化剂监控（可选，`MONITOR_ENABLED=true` 启用） | 384M | 100–200M |

全项目合计上限 ≤1.7G，给系统和你后面要部署的其他项目留了 2G+ 余量。
每个容器都限了 CPU 和内存、日志自动轮转（10M×3），不会拖垮整台机器。

镜像按 git commit 打 tag（如 `happystock-web:c433764`），发版即切换镜像，支持秒级回滚。

## 服务器要求

- Linux + Docker Engine + Compose v2（`docker compose version` 能出版本号即可）
- 国内服务器拉不动 Docker Hub 的话，先配镜像加速：编辑 `/etc/docker/daemon.json`
  加 `{"registry-mirrors": ["https://docker.m.daocloud.io"]}` 后 `systemctl restart docker`
- 建议加 2G swap 兜底（一次性）：
  `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
  并写入 `/etc/fstab`：`/swapfile none swap sw 0 0`

## 首次部署

**推荐：开发机一条命令（bootstrap）。** 服务器只需装好 Docker + Compose v2，
连 git clone 都不用；本机需要能 ssh 免密登录服务器（`ssh-copy-id`）。

```bash
bash deploy/bootstrap-remote.sh lingpeng@152.53.176.254 /opt/happystock
```

它自动完成：上传编排文件 → 生成服务器 `.env.production`（**API key 全部沿用本地
`.env`**，数据库密码/会话密钥自动生成，`BETTER_AUTH_URL` 默认 `http://152.53.176.254`）
→ 本机构建镜像推送并启动全部服务 → **把本地开发库的数据迁移到服务器**。
可把 `DEPLOY_HOST=user@ip`、`DEPLOY_PATH=/opt/happystock` 写进 `deploy/local.env`
（不进 git），以后所有脚本都不用带参数。

**备选：服务器上构建。** 服务器 `git clone` 仓库后：

```bash
bash deploy/first-deploy.sh        # 第一次运行：生成 .env.production（密钥自动生成）
vi .env.production                 # 填必填项：BETTER_AUTH_URL、NEXT_PUBLIC_FINNHUB_API_KEY
bash deploy/first-deploy.sh        # 再跑一次：构建 + 启动
```

构建期间会吃 2G 左右内存，务必先配好 swap；机器上已经跑着其他项目时不建议。
需要迁数据的话再在开发机执行 `bash deploy/push-data.sh user@服务器 /部署目录`。

**最后接上 nginx**（服务器已装好 nginx，web 容器默认只绑 127.0.0.1，公网流量必须走反代）：
按 `deploy/nginx.conf.example` 文件顶部的 5 步操作即可，之后访问 `http://152.53.176.254`。
防火墙只需放行 80/443，3000 端口不对外。

## 更新发版

```bash
# 方式 A：开发机上一条命令（推荐）
bash deploy/release-local.sh

# 方式 B：服务器上构建
bash deploy/update.sh              # git pull → 构建 → 滚动重启 → 健康检查
bash deploy/update.sh --no-pull    # 代码是 rsync/scp 传上来的话用这个
```

只改了 `.env.production`：服务器上 `bash deploy/update.sh --no-pull` 重启生效
（`NEXT_PUBLIC_FINNHUB_API_KEY` 是打进前端代码的，改它必须走完整发版重新构建）。

**发版流量（方式 A，实测）**：镜像打包后共约 107MB，但传输走 rsync 增量——
服务器保留上一次的 `deploy/images.tar` 作为基底，日常只改代码的发版**实际只传 ~2MB**；
改了依赖（package-lock.json 变化）时约几十 MB；仅首次发版需要全量 ~107MB。

## 回滚

```bash
bash deploy/rollback.sh            # 回到上一个版本（不重新构建，秒级）
bash deploy/rollback.sh <tag>      # 回到指定版本，tag 看 deploy/releases.log
```

自动保留最近 5 个版本的镜像；再早的需要 `git checkout` 对应 commit 重新构建。

## 日常运维

```bash
docker compose -p happystock ps                # 看状态
docker stats --no-stream                       # 看各容器实际内存/CPU 占用
docker compose -p happystock logs -f web       # 看网站日志
docker compose -p happystock logs -f monitor   # 看监控日志
docker compose -p happystock exec mongodb mongosh -u root -p   # 进数据库（密码在 .env.production）

# 备份数据库（建议加进 crontab）
docker compose -p happystock exec -T mongodb \
  mongodump -u root -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --archive --gzip > backup-$(date +%F).gz
```

## 同机部署多个项目

- 端口互不冲突即可：本项目对外只占 `WEB_PORT`（默认 3000），MongoDB 不占宿主机端口。
- 建议宿主机装一个 Nginx 按域名分发到各项目端口（见 `nginx.conf.example`）。
- 给每个项目都像本项目一样设 `mem_limit`/`cpus`/日志轮转，谁也别把机器吃满。
- 其他项目要用 MongoDB 的话可以复用本项目的实例（省 300M+ 内存）：
  接入 `happystock_default` 这个 docker 网络，连 `mongodb:27017`，建独立的库和账号即可。

## 域名和 HTTPS（可选）

现在按 IP 访问（`BETTER_AUTH_URL=http://152.53.176.254`）。以后上域名：
把 nginx 站点配置里的 `server_name` 换成域名，`certbot --nginx -d 域名` 签证书，
再把 `.env.production` 的 `BETTER_AUTH_URL` 改成 `https://你的域名`
（不改登录会失败），最后 `bash deploy/update.sh --no-pull` 重启生效。

## 文件说明

| 文件 | 作用 |
|---|---|
| `bootstrap-remote.sh` | **开发机上执行**：首次部署一条龙（配置沿用本地 + 建站 + 迁数据） |
| `push-data.sh` | **开发机上执行**：本地开发库数据迁移到服务器（非空库需 `--overwrite`） |
| `first-deploy.sh` | 首次部署备选路径（服务器上构建），服务器上执行 |
| `update.sh` | 更新发版；`--tag` 模式配合本机构建实现服务器零构建 |
| `release-local.sh` | **开发机上执行**：本机构建 → 推镜像 → 远程发版（小服务器推荐） |
| `rollback.sh` | 回滚到旧镜像 |
| `_common.sh` | 脚本共用函数 |
| `docker-compose.prod.yml` | 生产编排（勿直接 `docker compose up`，走脚本） |
| `Dockerfile` | 多阶段生产镜像：`web`（standalone）/ `monitor` 两个 target |
| `.env.production.example` | 配置模板 → 复制为仓库根目录 `.env.production` |
| `nginx.conf.example` | 域名/HTTPS 反代示例 |
| `local.env` | （开发机，不进 git）release-local.sh 的服务器地址配置 |
| `releases.log` | 发版记录（服务器上自动生成，不进 git） |
| `images.tar` | （服务器上自动生成，~110MB）增量传输的基底，删掉只会让下次发版变成全量 |
| `check-monitor-imports.mts` | monitor 镜像构建期依赖自检 |

## 常见问题

- **服务器构建时 OOM 被杀**：改用方式 A（`release-local.sh`），或加大 swap
- **本机交叉构建很慢**：Apple 芯片仿真 x86 构建 10–30 分钟属正常；有层缓存后会快很多
- **发版要传多少流量**：见上文"发版流量"；若以后想更快，可改用镜像仓库（如阿里云 ACR 个人版免费），`docker push` 天然按层去重，Dockerfile 已做了层拆分和时间戳归一化来配合
- **`IP:3000` 直接访问打不开**：正常——web 默认只绑 127.0.0.1 给 nginx 用；确要直连就在 `.env.production` 设 `WEB_BIND=0.0.0.0` 并重启
- **登录后跳转异常 / 一直登录失败**：`BETTER_AUTH_URL` 没写成浏览器实际访问的地址（走 nginx 时不带 `:3000`）
- **改了 MONGO_ROOT_PASSWORD 后连不上库**：数据库首次启动后密码就固化在数据卷里了，改回原值；确实要换密码需进 mongosh 手动改
- **Bark 收到重复推送**：服务器和本机同时在跑 catalyst-monitor；停掉本机的：`sh scripts/install-monitor-daemon.sh off`
- **root 目录的 `Dockerfile`/`docker-compose.yml`**：那是本地开发用的，生产一律用 `deploy/` 下这套
