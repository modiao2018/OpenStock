// 手动触发周报（不受周一时间窗和去重限制）：npm run monitor:report
import './env';
import { loadConfig, log } from './config';
import { closeStore } from './store';
import { sendWeeklyReport, composeWeeklyReport } from './collectors/weekly';

async function main(): Promise<void> {
  const config = loadConfig();
  if (process.argv.includes('--dry-run')) {
    const report = await composeWeeklyReport(config);
    console.log(`\n${report.subject}\n${'—'.repeat(40)}\n${report.text}\n`);
  } else {
    const ok = await sendWeeklyReport(config);
    log('weekly-cli', ok ? '周报已发送' : '周报发送失败（检查 Bark/邮件配置）');
  }
  await closeStore();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
