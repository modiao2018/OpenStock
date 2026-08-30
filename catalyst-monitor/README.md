# catalyst-monitor

医药股临床催化剂事件监控。独立于 OpenStock 主应用的常驻进程：不 import 主应用代码，自带 SQLite 存储（`data/monitor.db`）和 YAML 配置。

解决的问题见 `../docs/医药股临床数据公布前股价提前反应原因.md`：

1. **事后归因** —— 每条信息存 `published_at`（源声明的发布时间）+ `fetched_at`（首次抓取时间）+ 内容哈希。股价"提前异动"发生后可回查时间线，判断是信息源慢了还是市场提前定价。
2. **第一时间知道公告落地** —— 监控比公司 IR 页面更靠前的公开源：SEC EDGAR（8-K/6-K 的 acceptanceDateTime 是权威公开时点）、Nasdaq 停牌 RSS（T1 News Pending = 官方"即将发布"信号）、ClinicalTrials.gov 注册信息变更、新闻 wire RSS。
3. **催化剂日历** —— 试验的主要完成日期倒计时，事件前有准备而不是事件后被动反应。

## 一期范围（当前）

- 采集器：ClinicalTrials.gov API v2 / SEC EDGAR submissions / Nasdaq trade-halts RSS / 通用新闻 RSS（按 watchlist 关键词过滤）
- 推送：Bark（urgent 用 critical 级别，可绕过静音）+ 飞书群机器人；两者都没配时只记日志
- 二期计划：Alpaca 分钟行情 + abnormal return / RVOL 异动检测；三期：LLM 结构化解读 + 情景匹配 + 邮件日报

## 使用

```bash
cd catalyst-monitor
# 需要 Node 22（本机在 ~/.local/node/node-v22.14.0-darwin-arm64/bin）
npm install

cp .env.example .env   # 填 BARK_URL / FEISHU_WEBHOOK_URL / EDGAR_CONTACT
vi config.yaml          # 配置 watchlist：股票代码、公司名、NCT 编号、新闻关键词

npm run once      # 所有采集器跑一遍后退出（首轮为建档，不推送已有存量）
npm run daemon    # 常驻运行（美股盘中 = 北京时间 21:30–04:00，注意 Mac 别休眠）
npm run calendar  # 打印催化剂日历
```

## 行为说明

- **首次快照不推送**：ClinicalTrials 首轮建档只入库；EDGAR/新闻只推 `lookback_days` 内的新申报。避免启动刷屏。
- **变更检测**：同一实体（NCT/停牌）关键字段哈希变化才产生新事件；EDGAR 申报不可变，每份只推一次。
- **推送分级**：停牌、8-K、试验终止/结果发布 → urgent（Bark critical + 飞书）；其余 → normal（飞书为主）。
- **推送失败不阻塞采集**：渠道报错只记日志，事件仍入库（`notified=0`），可事后补查。

## 数据表

| 表 | 用途 |
|---|---|
| `events` | 信息时间线：source / external_id / published_at / fetched_at / content_hash / raw |
| `trials` | 试验最新快照（催化剂日历数据源） |
| `kv` | 缓存（EDGAR ticker→CIK 映射，24h 刷新） |

查询示例（事后归因）：

```sql
SELECT source, title, published_at, fetched_at
FROM events WHERE symbol = 'SRPT'
ORDER BY COALESCE(published_at, fetched_at);
```
