# catalyst-monitor

医药股临床催化剂事件监控。HappyStock 项目内的一个后台模块：与主应用共用依赖（根 package.json）、环境变量（根 `.env`）和 MongoDB，但作为独立的常驻进程运行，不参与 Next.js 构建路由。

解决的问题见 `../docs/医药股临床数据公布前股价提前反应原因.md`：

1. **事后归因** —— 每条信息存 `publishedAt`（源声明的发布时间）+ `fetchedAt`（首次抓取时间）+ 内容哈希。股价"提前异动"发生后可回查时间线，判断是信息源慢了还是市场提前定价。
2. **第一时间知道公告落地** —— 监控比公司 IR 页面更靠前的公开源：SEC EDGAR（8-K/6-K 的 acceptanceDateTime 是权威公开时点）、Nasdaq 停牌 RSS（T1 News Pending = 官方"即将发布"信号）、ClinicalTrials.gov 注册信息变更、新闻 wire RSS。
3. **催化剂日历** —— 试验的主要完成日期倒计时，事件前有准备而不是事件后被动反应。

## 一期范围（当前）

- 采集器：ClinicalTrials.gov API v2 / SEC EDGAR submissions / Nasdaq trade-halts RSS / 通用新闻 RSS（按 watchlist 关键词过滤）
- 推送：Bark（urgent 用 critical 级别，可绕过静音）；未配置时只记日志
- 二期计划：Alpaca 分钟行情 + abnormal return / RVOL 异动检测；三期：LLM 结构化解读 + 情景匹配 + 邮件日报

## 使用

在**仓库根目录**操作（无需单独安装依赖）：

```bash
# 1. 在根 .env 追加三个变量：
#    BARK_URL=https://api.day.app/你的设备key
#    EDGAR_CONTACT=你的邮箱（SEC 要求 User-Agent 带联系方式）

# 2. 编辑 catalyst-monitor/config.yaml，配置 watchlist（代码、公司名、NCT 编号、关键词）

npm run dev               # 【推荐】随主应用一起启停：dev.sh 会同时拉起监控 daemon
                          #   （caffeinate 防休眠，日志在 /tmp/catalyst-monitor.log），退出时一并停止
npm run monitor           # 单独常驻运行（不启动网页）
npm run monitor:once      # 所有采集器跑一遍后退出（首轮为建档，不推送已有存量）
npm run monitor:calendar  # 打印催化剂日历
npm run monitor:report -- --dry-run   # 生成周报预览（不发送）
sh scripts/install-monitor-daemon.sh  # 可选：装成 launchd 开机自启服务（不跟随 dev 启停）
```

三个命令都会先确保 MongoDB 容器已启动（`docker compose up -d --wait mongodb`）。

## 行为说明

- **首次快照不推送**：ClinicalTrials 首轮建档只入库；EDGAR/新闻只推 `lookback_days` 内的新申报。避免启动刷屏。
- **变更检测**：同一实体（NCT/停牌）关键字段哈希变化才产生新事件；EDGAR 申报不可变，每份只推一次。
- **推送分级**：停牌、8-K、试验终止/结果发布 → urgent（Bark critical，绕过静音）；其余 → normal（Bark timeSensitive）。
- **推送失败不阻塞采集**：渠道报错只记日志，事件仍入库（`notified=false`），可事后补查。
- **关注队列与降噪**（`config.yaml` 的 `focus` 段）：每 30 分钟对 AI 池 ∪ 催化剂清单打 0-100 关注分（回撤深度、连跌、内部人动向、AI 建议、信号叠加、催化剂临近、紧急事件）。`quiet: true` 时，非紧急提醒（连跌里程碑、内部人、催化剂提醒、普通申报/新闻）只有关注分 ≥ `threshold` 才实时 Bark，其余归入每天 `digest_hour_beijing` 点的摘要；停牌、8-K 等 urgent 事件与不绑定标的的消息不受影响。分数首次越过阈值时单独提醒一次（跌回阈值 −10 后复位）。

## 数据存储

模型定义在 `database/models/catalyst.model.ts`（与主应用同库）：

| Collection | 用途 |
|---|---|
| `catalystevents` | 信息时间线：source / externalId / publishedAt / fetchedAt / contentHash / raw；`(source, externalId, contentHash)` 唯一索引保证幂等 |
| `catalysttrials` | 试验最新快照（催化剂日历数据源） |
| `catalystkvs` | 缓存（EDGAR ticker→CIK 映射，24h 刷新） |
| `focusentries` | 关注队列：每只标的一条当前关注分与因子明细，整表覆盖；`/focus` 页读取 |
| `focusdigestitems` | 被闸门拦下的非紧急提醒，随每日摘要发出后标记 `sentAt`，30 天自动清理 |
| `signals` | 信号结果账本：每条推送（连跌里程碑 / 内部人 / 申报 / 停牌 / 异动 / 提醒）记入场日收盘，`outcomes` 采集器每小时回补 T+1/5/20 收益与相对基准（AI 池 QQQ、医药 XBI）的超额收益；网页 `/signals` 记分卡与周报据此统计 |

查询示例（事后归因，mongosh）：

```js
db.catalystevents.find({ symbol: 'SRPT' }, { source: 1, title: 1, publishedAt: 1, fetchedAt: 1 })
  .sort({ fetchedAt: 1 })
```
