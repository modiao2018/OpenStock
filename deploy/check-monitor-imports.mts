// monitor 镜像构建期自检：把 daemon 依赖的全部模块导入一遍
// （不含 daemon.ts 入口本身，它导入即启动）。
// 镜像里删掉了 next/react 等 web 依赖，如果误删了 monitor 需要的包
// 或 @/* 别名失效，这里会让 docker build 直接失败。
const modules = [
    'env', 'config', 'types', 'http', 'market-math',
    'store', 'notify', 'analyze', 'alpaca-daily',
    'form-parse', 'insider-alert', 'collector-registry',
    'collectors/clinicaltrials', 'collectors/edgar', 'collectors/halts',
    'collectors/rss', 'collectors/market', 'collectors/reminders',
    'collectors/weekly', 'collectors/discovery', 'collectors/aidips',
    'collectors/insider', 'collectors/insider-edgar',
    'collectors/sources', 'collectors/xcheck',
];
for (const m of modules) {
    await import(`../catalyst-monitor/src/${m}.ts`);
}
console.log('monitor imports OK');
process.exit(0);
