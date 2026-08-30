import './env';
import { loadConfig, log, logError } from './config';
import { closeStore, getKv, getWatchItems, insertEvent, markNotified, seedWatchItems, setEventAnalysis, setKv } from './store';
import { notify, pushMessage } from './notify';
import { analyzeEvent, extractAction } from './analyze';
import { collectClinicalTrials } from './collectors/clinicaltrials';
import { collectEdgar } from './collectors/edgar';
import { collectHalts } from './collectors/halts';
import { collectRss } from './collectors/rss';
import { collectMarket } from './collectors/market';
import { collectReminders } from './collectors/reminders';
import { collectWeekly } from './collectors/weekly';
import { collectDiscovery } from './collectors/discovery';
import { upsertCustomEvent } from './store';
import type { AnalysisResult } from './analyze';
import type { MonitorConfig, NewEvent } from './types';

interface CollectorDef {
  name: string;
  intervalMinutes: number;
  run: (config: MonitorConfig) => Promise<NewEvent[]>;
}

/** 公告里给了催化剂时间指引 → 自动补进催化剂日历 */
async function saveGuidance(
  scope: string,
  stored: { symbol?: string },
  result: AnalysisResult
): Promise<void> {
  if (!stored.symbol) return;
  for (const g of result.guidances) {
    const isNew = await upsertCustomEvent({
      symbol: stored.symbol,
      title: g.title,
      date: g.date,
      kind: g.kind,
      note: `AI 从公告中抽取（原文: ${g.dateText}）`,
      source: 'auto',
    });
    if (isNew) log(scope, `日历新增催化剂: ${stored.symbol} ${g.date} ${g.title}`);
  }
}

async function runCollector(def: CollectorDef, config: MonitorConfig): Promise<void> {
  let errorMsg: string | null = null;
  try {
    // 每轮都从数据库取最新监控清单——网页端改动无需重启 daemon
    const watchlist = await getWatchItems();
    if (watchlist.length === 0) {
      log(def.name, '监控清单为空，跳过本轮');
      return;
    }
    const candidates = await def.run({ ...config, watchlist });
    for (const ev of candidates) {
      const stored = await insertEvent(ev);
      if (!stored) continue; // 已见过、无变化

      if (stored.isFirstSnapshot && stored.source === 'clinicaltrials') {
        // 试验首次建档只是把现状存下来，不是"发生了什么"，不推送
        log(def.name, `建档（不推送）: ${stored.title}`);
        continue;
      }
      if (stored.archival) {
        // 历史回补：分析入库、抽取催化剂指引，但不打扰用户
        log(def.name, `历史建档: ${stored.title}`);
        const archResult = await analyzeEvent(config, stored);
        if (archResult.analysis) await setEventAnalysis(stored.id, archResult.analysis);
        await saveGuidance(def.name, stored, archResult);
        continue;
      }
      log(def.name, `新事件: ${stored.title}`);
      let result: AnalysisResult;
      if (stored.severity === 'urgent') {
        // 紧急事件：先推送再分析——LLM 的秒级延迟不能拖慢告警
        const delivered = await notify(config.env, stored);
        if (delivered) await markNotified(stored.id);
        result = await analyzeEvent(config, stored);
        if (result.analysis) {
          await setEventAnalysis(stored.id, result.analysis);
          const action = extractAction(result.analysis);
          await pushMessage(config.env, {
            title: `AI 分析${action ? `【${action}】` : ''}｜${stored.title}`,
            body: result.analysis,
            urgent: false,
            url: stored.url,
          });
        }
      } else {
        // 普通事件时效性要求低，分析随首条推送一起发，避免打扰两次
        result = await analyzeEvent(config, stored);
        if (result.analysis) {
          stored.analysis = result.analysis;
          await setEventAnalysis(stored.id, result.analysis);
        }
        const delivered = await notify(config.env, stored);
        if (delivered) await markNotified(stored.id);
      }
      await saveGuidance(def.name, stored, result);
    }
  } catch (err) {
    logError(def.name, err);
    errorMsg = err instanceof Error ? err.message : String(err);
  } finally {
    // 心跳 + 错误追踪：网页端"运行状态"面板据此显示在线/异常，
    // 连续失败 3 次推送"监控异常"，恢复后推送"已恢复"
    try {
      await setKv(`collector_last_run:${def.name}`, new Date().toISOString());
      const prevCount = Number((await getKv(`collector_error_count:${def.name}`)) ?? '0');
      if (errorMsg) {
        const count = prevCount + 1;
        await setKv(`collector_error_count:${def.name}`, String(count));
        await setKv(
          `collector_last_error:${def.name}`,
          JSON.stringify({ time: new Date().toISOString(), message: errorMsg.slice(0, 300) })
        );
        if (count === 3) {
          await pushMessage(config.env, {
            title: `监控异常｜${def.name} 连续 ${count} 次失败`,
            body: `最近错误: ${errorMsg.slice(0, 300)}\n采集会继续重试；请检查网络或密钥配置，详情见页面"运行状态"面板`,
            urgent: false,
          });
        }
      } else {
        if (prevCount >= 3) {
          await pushMessage(config.env, {
            title: `监控恢复｜${def.name} 已恢复正常`,
            body: `此前连续失败 ${prevCount} 次，本轮已成功`,
            urgent: false,
          });
        }
        if (prevCount > 0) await setKv(`collector_error_count:${def.name}`, '0');
        await setKv(`collector_last_error:${def.name}`, '');
      }
    } catch {
      // 数据库不可用时上面已报过错，追踪失败不再刷屏
    }
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const config = loadConfig();

  const collectors: CollectorDef[] = [
    { name: 'market', intervalMinutes: config.poll.marketMinutes, run: collectMarket },
    { name: 'halts', intervalMinutes: config.poll.haltsMinutes, run: collectHalts },
    { name: 'edgar', intervalMinutes: config.poll.edgarMinutes, run: collectEdgar },
    { name: 'rss', intervalMinutes: config.poll.rssMinutes, run: collectRss },
    { name: 'clinicaltrials', intervalMinutes: config.poll.clinicaltrialsMinutes, run: collectClinicalTrials },
    { name: 'discovery', intervalMinutes: 720, run: collectDiscovery },
    { name: 'reminders', intervalMinutes: 360, run: collectReminders },
    { name: 'weekly', intervalMinutes: 60, run: collectWeekly },
  ];

  // 首次运行：把 config.yaml 里的条目迁移入库，此后以数据库（网页端管理）为准
  let watchItems = await getWatchItems();
  if (watchItems.length === 0 && config.watchlist.length > 0) {
    await seedWatchItems(config.watchlist);
    watchItems = config.watchlist;
    log('daemon', `监控清单已从 config.yaml 迁移入库（${watchItems.length} 条）`);
  }

  log(
    'daemon',
    `启动，监控 ${watchItems.map((w) => w.symbol).join(', ') || '（空）'}；` +
      `推送渠道: ${config.env.barkUrl ? 'Bark' : '未配置'}`
  );

  if (once) {
    for (const def of collectors) {
      await runCollector(def, config);
    }
    await closeStore();
    log('daemon', '单次运行完成');
    return;
  }

  const timers: NodeJS.Timeout[] = [];

  // dead man's switch：定期 ping 外部健康检查服务（如 healthchecks.io），
  // daemon 挂掉后由对方超时告警——监控系统自身的掉线不能靠自己发现
  const healthcheckUrl = process.env.HEALTHCHECK_URL;
  if (healthcheckUrl) {
    const ping = () => void fetch(healthcheckUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
    ping();
    timers.push(setInterval(ping, 5 * 60_000));
    log('daemon', 'healthcheck 心跳已启用（每 5 分钟）');
  }

  for (const def of collectors) {
    void runCollector(def, config);
    timers.push(setInterval(() => void runCollector(def, config), def.intervalMinutes * 60_000));
  }

  const shutdown = () => {
    log('daemon', '收到退出信号，清理中…');
    timers.forEach(clearInterval);
    void closeStore().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logError('daemon', err);
  process.exit(1);
});
