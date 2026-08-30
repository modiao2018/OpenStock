# 生产镜像，多阶段构建，针对小内存服务器优化：
#   --target web     Next.js standalone 运行镜像（~200MB，只含用到的依赖）
#   --target monitor catalyst-monitor 运行镜像（生产依赖 + tsx，无 Next.js）
# 完整 node_modules 只存在于构建阶段，不进最终镜像。

# ---------- 生产依赖层（monitor 运行时用） ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 删除 monitor 用不到的纯 web 依赖（next/react/swc 等占 ~600MB）。
# 必须与 npm ci 同阶段删：后续 COPY --from=deps 拷的是本阶段终态，删除才真正生效。
# 删多了会被 monitor 阶段的构建期导入自检拦住，不会带病上线。
RUN npm ci --omit=dev && rm -rf \
    node_modules/next node_modules/@next node_modules/@swc \
    node_modules/@opentelemetry node_modules/@img \
    node_modules/react node_modules/react-dom node_modules/@radix-ui \
    node_modules/lucide-react node_modules/typescript \
    node_modules/better-auth node_modules/inngest

# ---------- 构建层 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* 变量在 next build 时被内联进前端产物，必须以 build arg 传入；
# 改了这个 key 需要重新 build 镜像，仅改运行时 env 不生效
ARG NEXT_PUBLIC_FINNHUB_API_KEY
ENV NEXT_PUBLIC_FINNHUB_API_KEY=$NEXT_PUBLIC_FINNHUB_API_KEY

# 限制构建期 V8 堆内存，避免在小内存服务器上构建时 OOM 被杀
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build
# 把 standalone 的 node_modules 挪出来单独成层（下面 web 阶段分开 COPY），
# 并归一化 mtime（next build 每次重新拷贝这些文件，时间戳会全变）。
# rsync 增量传输不依赖这个，但依赖不变时层摘要稳定，
# 将来若改用镜像仓库（registry）发版，按层去重才有效
RUN mv .next/standalone/node_modules /opt/standalone-node-modules \
    && find /opt/standalone-node-modules public -exec touch -h -t 200001010000.00 {} +

# ---------- web 运行镜像 ----------
FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
# 稳定层在前（依赖、静态资源），每次都变的应用代码层在后
COPY --from=build /opt/standalone-node-modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]

# ---------- monitor 运行镜像 ----------
FROM node:22-alpine AS monitor
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g tsx@4
COPY --from=deps /app/node_modules ./node_modules
# tsconfig 提供 @/* 路径别名给 tsx；monitor 会 import @/lib 和 @/database
COPY package.json tsconfig.json ./
COPY catalyst-monitor ./catalyst-monitor
COPY database ./database
COPY lib ./lib
# 构建期自检：依赖缺失/别名失效会让构建直接失败，而不是部署后才崩
COPY deploy/check-monitor-imports.mts ./deploy/
RUN tsx deploy/check-monitor-imports.mts
CMD ["tsx", "catalyst-monitor/src/daemon.ts"]
