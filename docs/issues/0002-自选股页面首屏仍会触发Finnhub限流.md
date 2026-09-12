# 0002 自选股页面首屏仍会触发 Finnhub 限流

- 日期：2026-09-12
- 影响：自选股页面（/watchlist）首屏的报价列和新闻区，冷加载时部分行显示空值或旧值，约一分钟后轮询补齐
- 状态：待处理

## 现象

5938dd3 发版后第一次打开自选股页面，UTC 07:54 一分钟内 23 条 `Finnhub local rate limit reached`，来源是 `getWatchlistData` 的逐只报价、`getNews` 的逐只公司新闻各一条。

## 原因

`lib/actions/finnhub.actions.ts` 里 `getWatchlistData`、`getWatchlistQuotes`、`getNews` 仍按自选股数量全量并发请求，没有走热力图 / AI 低吸那套"按额度挑选、最旧优先、其余沿用快照"的逻辑。自选股 17 只 × (报价 + 新闻) 就超过一分钟 50 次的门槛。报价 URL 与热力图共用 memo，所以热力图刚刷过时会好一些，但新闻是独立请求。

## 处理建议

- 报价：复用 `pickWithinBudget` + 快照回填，和热力图一致。
- 新闻：公司新闻 5 分钟 memo 已经有，但首屏仍是 N 次并发；可改为只取前若干只，或改用一次 general news 兜底、逐只新闻后台补。
- 长期：服务端定时统一拉一轮写快照，页面只读快照。

## 时间线

- 2026-09-12 关闭 0001 时从日志发现，记录待处理
