import './env';
import { loadConfig, log, logError } from './config';
import { closeStore, getWatchItems, insertEvent, markNotified, seedWatchItems, setKv } from './store';
import { notify } from './notify';
import { collectClinicalTrials } from './collectors/clinicaltrials';
import { collectEdgar } from './collectors/edgar';
import { collectHalts } from './collectors/halts';
import { collectRss } from './collectors/rss';
import type { MonitorConfig, NewEvent } from './types';

interface CollectorDef {
  name: string;
  intervalMinutes: number;
  run: (config: MonitorConfig) => Promise<NewEvent[]>;
}

async function runCollector(def: CollectorDef, config: MonitorConfig): Promise<void> {
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
      log(def.name, `新事件: ${stored.title}`);
      const delivered = await notify(config, stored);
      if (delivered) await markNotified(stored.id);
    }
  } catch (err) {
    logError(def.name, err);
  } finally {
    // 心跳：网页端"运行状态"面板据此判断 daemon 是否在线、各采集器上次运行时间
    try {
      await setKv(`collector_last_run:${def.name}`, new Date().toISOString());
    } catch {
      // 数据库不可用时上面已报过错，心跳失败不再刷屏
    }
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const config = loadConfig();

  const collectors: CollectorDef[] = [
    { name: 'halts', intervalMinutes: config.poll.haltsMinutes, run: collectHalts },
    { name: 'edgar', intervalMinutes: config.poll.edgarMinutes, run: collectEdgar },
    { name: 'rss', intervalMinutes: config.poll.rssMinutes, run: collectRss },
    { name: 'clinicaltrials', intervalMinutes: config.poll.clinicaltrialsMinutes, run: collectClinicalTrials },
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
