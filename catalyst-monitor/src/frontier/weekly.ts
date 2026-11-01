import { transporter } from '@/lib/nodemailer';
import { connectToDatabase } from '@/database/mongoose';
import {
  FrontierConference,
  FrontierDeal,
  FrontierEvent,
  FrontierFund,
  FrontierItem,
  FrontierMilestone,
  FrontierReport,
  FrontierTheme,
} from '@/database/models/frontier.model';
import { daysBetween, isoWeekOf, parseJsonLoose, phaseLabel } from '@/lib/frontier-math';
import { log, logError } from '../config';
import { getKv, setKv } from '../store';
import { pushMessage } from '../notify';
import { frontierLlm } from './llm';
import { BASKETS_KEY, type BasketSnapshot } from './sources/baskets';
import type { MonitorConfig, NewEvent } from '../types';

/**
 * 生物科技前沿周报：每周一北京时间上午发送，按 ISO 周去重。
 * 全部基于本周已有的分拣/分析结果汇总，只额外调一次 LLM（周评 + 论文精选合并在一次调用里）。
 */

export const PAPERS_KEY = 'frontier_papers';

export interface PaperPick {
  title: string;
  url?: string;
  feed: string;
  zh: string;
}

const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

/** 截到不超过 max 字的最后一个句号；整段没有句号就硬截加省略号 */
function firstSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('。');
  return end > 20 ? cut.slice(0, end + 1) : `${cut}…`;
}

const CHANGE_ZH: Record<string, string> = { new: '新建仓', add: '加仓', trim: '减仓', exit: '清仓' };

export async function composeFrontierWeekly(config: MonitorConfig, now = new Date()): Promise<{ week: string; subject: string; text: string }> {
  await connectToDatabase();
  const since = new Date(now.getTime() - 7 * 24 * 3600_000);
  const week = isoWeekOf(now);
  const themes = await FrontierTheme.find({ enabled: true }).sort({ order: 1 }).lean();
  const events = await FrontierEvent.find({ firstSeenAt: { $gte: since }, dismissed: false }).sort({ importance: -1, sourceCount: -1 }).lean();
  const sections: string[] = [];

  // 各主题本周要闻
  const themeBlocks: string[] = [];
  for (const t of themes) {
    const evs = events.filter((e) => e.themes.includes(t.key) && (e.importance ?? 0) >= 3);
    if (evs.length === 0) continue;
    const lines = evs.slice(0, 3).map((e) => `· ${e.titleZh || e.title}${'★'.repeat(e.importance ?? 0)}${e.analysis?.summary ? `\n  ${firstSentences(e.analysis.summary, 110)}` : ''}`);
    themeBlocks.push(`▍${t.name}（${evs.length} 条）\n${lines.join('\n')}`);
  }
  const important = events.filter((e) => (e.importance ?? 0) >= 4).length;
  sections.push(`【本周概况】共 ${events.length} 个事件，重要（4–5 星）${important} 个`);
  if (themeBlocks.length) sections.push(`【各主题要闻】\n${themeBlocks.join('\n')}`);

  // 交易
  const deals = await FrontierDeal.find({ date: { $gte: since } }).lean();
  if (deals.length) {
    deals.sort((a, b) => (b.total?.usd ?? b.upfront?.usd ?? 0) - (a.total?.usd ?? a.upfront?.usd ?? 0));
    sections.push(
      `【交易追踪 ${deals.length} 笔】\n` +
        deals
          .slice(0, 8)
          .map((d) => {
            const money = [d.upfront?.text ? `首付 ${d.upfront.text}${d.upfront.verified ? '' : '(未核实)'}` : '', d.total?.text ? `总额 ${d.total.text}${d.total.verified ? '' : '(未核实)'}` : '']
              .filter(Boolean)
              .join('，');
            return `· ${d.buyer || '?'} ← ${d.seller || '?'}：${d.asset}${money ? `（${money}）` : ''}`;
          })
          .join('\n'),
    );
  }

  // AI 药物记分板
  const milestones = await FrontierMilestone.find({ status: 'active' }).lean();
  const moved = milestones.flatMap((m) => m.history.filter((h) => h.kind === 'phase' && h.at >= since).map((h) => `· ${m.drug}（${m.company}）：${h.text}`));
  const today = now.toISOString().slice(0, 10);
  const upcoming = milestones
    .filter((m) => m.registry?.nextReadout && daysBetween(today, m.registry.nextReadout) <= 90)
    .sort((a, b) => a.registry!.nextReadout!.localeCompare(b.registry!.nextReadout!))
    .map((m) => `· ${m.registry!.nextReadout} ${m.drug}（${phaseLabel(m.registry!.maxPhase)}，${m.company}）`);
  const proposals = milestones.reduce((n, m) => n + m.proposals.length, 0) + (await FrontierMilestone.countDocuments({ status: 'proposed' }));
  const msLines = [
    moved.length ? `本周变化：\n${moved.join('\n')}` : '本周登记库无变化',
    upcoming.length ? `90 天内可能读出（按主要完成日）：\n${upcoming.slice(0, 6).join('\n')}` : null,
    proposals ? `有 ${proposals} 条 AI 提议待你在记分板上确认` : null,
  ].filter(Boolean);
  sections.push(`【AI 药物记分板】\n${msLines.join('\n')}`);

  // 主题篮子
  const basketsRaw = await getKv(BASKETS_KEY);
  if (basketsRaw) {
    const snap = JSON.parse(basketsRaw) as BasketSnapshot;
    const rows = themes
      .filter((t) => snap.themes[t.key])
      .map((t) => {
        const s = snap.themes[t.key];
        return `· ${t.name}：20 日 ${fmtPct(s.ret[20])}，相对 ${snap.benchmark} ${fmtPct(s.excess[20])}`;
      });
    if (rows.length) sections.push(`【主题篮子（等权）】\n${rows.join('\n')}`);
  }

  // 13F
  const funds = await FrontierFund.find({ filedAt: { $gte: since.toISOString().slice(0, 10) } }).lean();
  if (funds.length) {
    sections.push(
      `【机构动向（本周新季报）】\n` +
        funds
          .map((f) => `· ${f.name}（${f.period}）：${f.changes.slice(0, 3).map((c) => `${CHANGE_ZH[c.change]} ${c.symbol ?? c.issuer}`).join('，') || '无显著变动'}`)
          .join('\n'),
    );
  }

  // 会议
  const confs = (await FrontierConference.find({ startDate: { $gte: today } }).sort({ startDate: 1 }).limit(8).lean()).filter(
    (c) => daysBetween(today, c.startDate) <= 31,
  );
  if (confs.length) sections.push(`【未来一个月的会议】\n${confs.map((c) => `· ${c.dateText || c.startDate} ${c.name}`).join('\n')}`);

  // 一次 LLM：周评 + 论文精选
  const papers = await FrontierItem.find({ status: 'paper', fetchedAt: { $gte: since } }).sort({ fetchedAt: -1 }).limit(80).lean();
  const topEvents = events.filter((e) => (e.importance ?? 0) >= 3).slice(0, 25);
  if (topEvents.length || papers.length) {
    const prompt =
      '你是美股生物医药行业分析师，读者是不熟悉医药的中国投资者。根据下面本周已整理的事件和论文候选，' +
      '只输出一个 JSON 对象：{"comment":"不超过 200 字：本周主线是什么、哪个主题在加速或降温、下周最该盯什么；只依据给出的信息",' +
      '"papers":[{"i":论文编号,"zh":"不超过 50 字：讲了什么、为什么值得看"}]}。papers 从候选里挑最多 5 篇最可能影响产业的，没有就 []。\n\n' +
      `本周事件：\n${topEvents.map((e) => `- [${e.themes.join(',')}] ${e.titleZh || e.title}（${e.importance}星）${e.analysis?.summary ? `：${e.analysis.summary.slice(0, 80)}` : ''}`).join('\n') || '无'}\n\n` +
      `论文候选：\n${papers.map((p, i) => `${i + 1}. ${p.title}（${p.feed}）`).join('\n') || '无'}`;
    const reply = await frontierLlm(config, 'weekly', prompt);
    const parsed = reply ? parseJsonLoose<{ comment?: string; papers?: Array<{ i?: number; zh?: string }> }>(reply) : null;
    if (parsed?.comment) sections.unshift(`【AI 周评】${String(parsed.comment).slice(0, 400)}`);
    const picks: PaperPick[] = (parsed?.papers ?? [])
      .filter((p) => typeof p.i === 'number' && papers[p.i - 1] && p.zh)
      .slice(0, 5)
      .map((p) => {
        const paper = papers[p.i! - 1];
        return { title: paper.title, url: paper.url, feed: paper.feed, zh: String(p.zh).slice(0, 120) };
      });
    if (picks.length) {
      await setKv(PAPERS_KEY, JSON.stringify({ week, picks, candidates: papers.length }));
      sections.push(`【本周论文精选】\n${picks.map((p) => `· ${p.zh}\n  ${p.title}${p.url ? `\n  ${p.url}` : ''}`).join('\n')}`);
    }
  }

  return { week, subject: `生物科技前沿周报 ${week}`, text: sections.join('\n\n') };
}

async function deliver(config: MonitorConfig, report: { subject: string; text: string }): Promise<boolean> {
  const to = process.env.ALERT_EMAIL || process.env.NODEMAILER_EMAIL;
  const site = process.env.BETTER_AUTH_URL;
  if (transporter && to) {
    try {
      await transporter.sendMail({
        from: `"HappyStock" <${process.env.NODEMAILER_EMAIL}>`,
        to,
        subject: report.subject,
        text: `${report.text}${site ? `\n\n完整版：${site}/frontier?tab=report` : ''}`,
      });
      return true;
    } catch (err) {
      logError('frontier:weekly:email', err);
    }
  }
  return pushMessage(config.env, {
    title: report.subject,
    body: report.text,
    urgent: false,
    url: site ? `${site}/frontier?tab=report` : undefined,
  });
}

/** 每周一北京时间 9–12 点窗口内的第一次轮询生成并发送，按 ISO 周去重 */
export async function collectFrontierWeekly(config: MonitorConfig): Promise<NewEvent[]> {
  const bj = new Date(Date.now() + 8 * 3600_000);
  if (bj.getUTCDay() !== 1 || bj.getUTCHours() < 9 || bj.getUTCHours() >= 12) return [];
  const week = isoWeekOf(new Date());
  const key = `frontier_weekly:${week}`;
  if (await getKv(key)) return [];

  const report = await composeFrontierWeekly(config);
  await FrontierReport.updateOne({ week: report.week }, { $set: { subject: report.subject, text: report.text } }, { upsert: true });
  const delivered = await deliver(config, report);
  // 报告已存库（页面可看），推送失败也不重复生成——避免重复消耗 LLM
  await setKv(key, new Date().toISOString());
  log('frontier:weekly', `${report.subject} 已生成（推送${delivered ? '成功' : '未送达'}）`);
  return [];
}
