// 手动跑生物科技前沿（不受调度间隔限制）：
//   npm run monitor:frontier -- ingest            全部数据源立即采集一轮
//   npm run monitor:frontier -- brain             合并 / 分拣 / 深度分析 / 推送一轮
//   npm run monitor:frontier -- weekly --dry-run  生成周报并打印（--dry-run 不推送、不存库）
import '../env';
import { loadConfig, log } from '../config';
import { closeStore } from '../store';
import { ensureFrontierSeed, loadThemes } from '@/lib/frontier-db';
import { FrontierReport } from '@/database/models/frontier.model';
import { insertItems, writeSourceStatus } from './store';
import { FRONTIER_SOURCES } from './ingest';
import { collectFrontierBrain } from './brain';
import { composeFrontierWeekly } from './weekly';

async function main(): Promise<void> {
  const config = loadConfig();
  const cmd = process.argv[2] ?? 'ingest';
  await ensureFrontierSeed();

  if (cmd === 'ingest') {
    const themes = await loadThemes();
    const only = process.argv[3];
    for (const src of FRONTIER_SOURCES) {
      if (only && only !== src.id) continue;
      const start = Date.now();
      try {
        const { items, seen } = await src.run({ config, themes, lastRun: null });
        const added = await insertItems(items);
        const now = new Date().toISOString();
        await writeSourceStatus(src.id, { at: now, ok: true, added, seen, lastOkAt: now });
        log('frontier-cli', `${src.id}: 抓到 ${seen}，初筛后 ${items.length}，新增 ${added}（${Date.now() - start}ms）`);
      } catch (err) {
        log('frontier-cli', `${src.id} 失败: ${err instanceof Error ? err.message : err}`);
      }
    }
  } else if (cmd === 'brain') {
    await collectFrontierBrain(config);
  } else if (cmd === 'weekly') {
    const report = await composeFrontierWeekly(config);
    console.log(`\n${report.subject}\n${'—'.repeat(40)}\n${report.text}\n`);
    if (!process.argv.includes('--dry-run')) {
      await FrontierReport.updateOne({ week: report.week }, { $set: { subject: report.subject, text: report.text } }, { upsert: true });
      log('frontier-cli', '周报已存库（页面"周报"标签可见）');
    }
  } else {
    console.error(`未知命令 ${cmd}，可用：ingest [源] | brain | weekly [--dry-run]`);
  }
  await closeStore();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
