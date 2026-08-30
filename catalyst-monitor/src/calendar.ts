import './env';
import { closeStore, listTrials } from './store';

/** 催化剂日历：列出所有已建档试验的关键日期，按主要完成日期排序 */
async function main(): Promise<void> {
  const trials = await listTrials();
  await closeStore();

  if (trials.length === 0) {
    console.log('尚无试验数据。先运行 npm run monitor:once 建档。');
    return;
  }

  const today = new Date();
  console.log(`\n📅 催化剂日历（${trials.length} 个试验，按主要完成日期排序）\n`);

  for (const t of trials) {
    const pcd = t.primaryCompletionDate;
    let countdown = '日期未知';
    if (pcd) {
      const days = Math.ceil((Date.parse(pcd) - today.getTime()) / 86_400_000);
      countdown = days >= 0 ? `${days} 天后` : `已过 ${-days} 天`;
    }
    console.log(`■ ${t.symbol}  ${t.nctId}  [${t.phase}]  ${t.overallStatus}${t.hasResults ? '  ✅已有结果' : ''}`);
    console.log(`  ${t.title}`);
    console.log(`  主要完成: ${pcd ?? '—'}（${countdown}）  研究完成: ${t.completionDate ?? '—'}  最近更新: ${t.lastUpdatePostDate ?? '—'}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
