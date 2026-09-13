# 0002 自选股页面首屏仍会触发 Finnhub 限流

- 日期：2026-09-12
- 影响：自选股页面（/watchlist）首屏的报价列和新闻区，冷加载时部分行显示空值或旧值，约一分钟后轮询补齐
- 状态：已关闭（e76899b，2026-09-13 发版 8a7dbb9 后验证）

## 现象

5938dd3 发版后第一次打开自选股页面，UTC 07:54 一分钟内 23 条 `Finnhub local rate limit reached`，来源是 `getWatchlistData` 的逐只报价、`getNews` 的逐只公司新闻各一条。

## 原因

`lib/actions/finnhub.actions.ts` 里 `getWatchlistData`、`getWatchlistQuotes`、`getNews` 仍按自选股数量全量并发请求，没有走热力图 / AI 低吸那套"按额度挑选、最旧优先、其余沿用快照"的逻辑。自选股 17 只 × (报价 + 新闻) 就超过一分钟 50 次的门槛。报价 URL 与热力图共用 memo，所以热力图刚刷过时会好一些，但新闻是独立请求。

## 处理

e76899b（2026-09-13）：

- 报价：`getWatchlistData` / `getWatchlistQuotes` 改走热力图那套。先读自选股快照和 Mongo 里的公司资料，按"每只要花几次上游调用"（报价 memo 命中为 0，资料一天内新鲜为 0）算成本，在 `finnhubGate.freeSlots` 额度内挑最旧的那批拉，其余行沿用快照，返回顺序仍按调用方给的顺序。行上新增 `fetchedAt` / `quoteTime`，从没拿到过价格或行情落后两个收盘的行排最前。30 秒轮询用的 `getWatchlistQuotes` 走同一条路但不买资料，并把 `fetchedAt` 写回快照，轮转顺序才不会停在首屏那一刻。
- 新闻：公司新闻按股票存进 `news:<hash>` 快照。每次渲染最多刷新 8 只（再受门槛剩余额度限制），最旧优先；快照里 5 分钟内的条目视同 memo 命中不再买；其余股票从快照取。首屏拉不到时仍退回一次 general news。
- 没有做的：表格里没加"N 只本轮未刷新"的提示（AI 低吸有）；服务端定时统一拉快照仍是长期方案。

## 验证方法

发版后冷启动打开 /watchlist，看 `docker logs happystock-web-1 | grep "rate limit"` 在该分钟内应为 0 条；首屏表格各行应有价（来自快照），一两次轮询后 `fetchedAt` 最旧的行先更新；新闻区先出 8 只的新闻，第二次打开补齐其余。

## 时间线

- 2026-09-12 关闭 0001 时从日志发现，记录待处理
- 2026-09-13 提交 e76899b：报价按额度轮转 + 快照回填，公司新闻按股票快照、每次最多刷 8 只；单测 13 个用例；待发版验证
- 2026-09-13 11:31 UTC 发版后首次打开自选股页面（18 只）验证：web 日志该时段 0 条 `rate limit`；快照 18/18 行有价、全部带 `fetchedAt`；新闻快照按预期先拉 8 只（PTGX/VCYT/TWST/LRCX/NTLA/ABSI/HYFT/SDGR）。关闭。ARKG/GNOM/HEAL/IDNA 4 只名字仍是代码，是 ETF 在 Finnhub 无公司资料，与本次无关。
