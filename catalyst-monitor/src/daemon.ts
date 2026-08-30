import { loadConfig, log, logError } from './config.js';
import { Store } from './store.js';
import { notify } from './notify.js';
import { collectClinicalTrials } from './collectors/clinicaltrials.js';
import { collectEdgar } from './collectors/edgar.js';
import { collectHalts } from './collectors/halts.js';
import { collectRss } from './collectors/rss.js';
import type { MonitorConfig, NewEvent } from './types.js';

interface CollectorDef {
  name: string;
  intervalMinutes: number;
  run: (config: MonitorConfig, store: Store) => Promise<NewEvent[]>;
}

async function runCollector(def: CollectorDef, config: MonitorConfig, store: Store): Promise<void> {
  try {
    const candidates = await def.run(config, store);
    for (const ev of candidates) {
      const stored = store.insertEvent(ev);
      if (!stored) continue; // 已见过、无变化

      if (stored.isFirstSnapshot && stored.source === 'clinicaltrials') {
        // 试验首次建档只是把现状存下来，不是"发生了什么"，不推送
        log(def.name, `建档（不推送）: ${stored.title}`);
        continue;
      }
      log(def.name, `新事件: ${stored.title}`);
      const delivered = await notify(config, stored);
      if (delivered) store.markNotified(stored.id);
    }
  } catch (err) {
    logError(def.name, err);
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const config = loadConfig();
  const store = new Store();

  const collectors: CollectorDef[] = [
    { name: 'halts', intervalMinutes: config.poll.haltsMinutes, run: (c) => collectHalts(c) },
    { name: 'edgar', intervalMinutes: config.poll.edgarMinutes, run: collectEdgar },
    { name: 'rss', intervalMinutes: config.poll.rssMinutes, run: (c) => collectRss(c) },
    { name: 'clinicaltrials', intervalMinutes: config.poll.clinicaltrialsMinutes, run: collectClinicalTrials },
  ];

  log(
    'daemon',
    `启动，监控 ${config.watchlist.map((w) => w.symbol).join(', ')}；` +
      `推送渠道: ${[config.env.barkUrl && 'Bark', config.env.feishuWebhookUrl && '飞书'].filter(Boolean).join('+') || '未配置'}`
  );

  if (once) {
    for (const def of collectors) {
      await runCollector(def, config, store);
    }
    store.close();
    log('daemon', '单次运行完成');
    return;
  }

  const timers: NodeJS.Timeout[] = [];
  for (const def of collectors) {
    void runCollector(def, config, store);
    timers.push(setInterval(() => void runCollector(def, config, store), def.intervalMinutes * 60_000));
  }

  const shutdown = () => {
    log('daemon', '收到退出信号，清理中…');
    timers.forEach(clearInterval);
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logError('daemon', err);
  process.exit(1);
});
