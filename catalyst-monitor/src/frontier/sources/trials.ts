import { connectToDatabase } from '@/database/mongoose';
import { FrontierMilestone } from '@/database/models/frontier.model';
import { companyCore, keywordHit, phaseLabel, summarizeRegistry, type RegistryTrial } from '@/lib/frontier-math';
import { log, logError } from '../../config';
import { fetchWithRetry } from '../../http';
import { createRuleEvent, type NewFrontierItem, type SourceContext } from '../store';

/**
 * ClinicalTrials.gov 两件事：
 * 1) 各主题新登记的企业二/三期试验——药企往哪个方向砸钱的早期信号；
 * 2) AI 药物记分板：按药物名查全部试验，实时算出最高阶段与下次读出时间。
 *    阶段是登记库的事实，不经过 LLM；升期时直接生成事件。
 */

const API = 'https://clinicaltrials.gov/api/v2/studies';
const FIELDS = 'NCTId,BriefTitle,Phase,OverallStatus,PrimaryCompletionDate,LeadSponsorName,Condition,InterventionName,StudyFirstPostDate';

interface CtStudy {
  protocolSection: {
    identificationModule: { nctId: string; briefTitle?: string };
    statusModule?: {
      overallStatus?: string;
      primaryCompletionDateStruct?: { date?: string };
      studyFirstPostDateStruct?: { date?: string };
    };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    designModule?: { phases?: string[] };
    conditionsModule?: { conditions?: string[] };
    armsInterventionsModule?: { interventions?: Array<{ name?: string }> };
  };
}

async function query(params: Record<string, string>): Promise<CtStudy[]> {
  const qs = new URLSearchParams({ ...params, fields: FIELDS, pageSize: '100', format: 'json' });
  const res = await fetchWithRetry(`${API}?${qs}`, { headers: { Accept: 'application/json' } }, { timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`ClinicalTrials.gov HTTP ${res.status}`);
  const data = (await res.json()) as { studies?: CtStudy[] };
  return data.studies ?? [];
}

const PHASE_TEXT: Record<string, string> = { PHASE2: 'Phase 2', PHASE3: 'Phase 3', PHASE1: 'Phase 1', PHASE4: 'Phase 4' };

async function collectThemeTrials(ctx: SourceContext): Promise<NewFrontierItem[]> {
  const since = new Date(Date.now() - (ctx.lastRun ? 3 : 14) * 24 * 3600_000).toISOString().slice(0, 10);
  const items: NewFrontierItem[] = [];
  for (const theme of ctx.themes) {
    if (!theme.trialQuery) continue;
    try {
      const studies = await query({
        [theme.trialQuery.field]: theme.trialQuery.term,
        'filter.advanced':
          `AREA[StudyFirstPostDate]RANGE[${since},MAX] AND AREA[LeadSponsorClass]INDUSTRY ` +
          'AND (AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)',
      });
      for (const s of studies) {
        const p = s.protocolSection;
        const nct = p.identificationModule.nctId;
        const sponsor = p.sponsorCollaboratorsModule?.leadSponsor?.name ?? '';
        const phases = p.designModule?.phases ?? [];
        const phaseText = phases.map((x) => PHASE_TEXT[x] ?? x).join('/');
        const interventions = (p.armsInterventionsModule?.interventions ?? []).map((i) => i.name).filter(Boolean).slice(0, 4);
        const conditions = (p.conditionsModule?.conditions ?? []).slice(0, 4);
        // 主办方 ↔ 主题标的：按公司名主体做全词匹配
        const tickers = theme.tickers
          .filter((t) => [companyCore(t.company), ...(t.aliases ?? [])].some((n) => n.length >= 4 && keywordHit(sponsor, n)))
          .map((t) => t.symbol);
        items.push({
          source: 'trial',
          externalId: nct,
          feed: 'ClinicalTrials.gov',
          title: `New ${phaseText} trial by ${sponsor}: ${p.identificationModule.briefTitle ?? nct}`,
          url: `https://clinicaltrials.gov/study/${nct}`,
          snippet: `Sponsor: ${sponsor}. Phase: ${phaseText}. Conditions: ${conditions.join(', ')}. Interventions: ${interventions.join(', ')}. First posted ${p.statusModule?.studyFirstPostDateStruct?.date ?? ''}.`,
          publishedAt: p.statusModule?.studyFirstPostDateStruct?.date
            ? new Date(`${p.statusModule.studyFirstPostDateStruct.date}T12:00:00Z`)
            : null,
          ruleThemes: [theme.key],
          ruleTickers: tickers,
          raw: { sponsor, phases, conditions, interventions },
        });
      }
    } catch (err) {
      logError(`frontier:trials:${theme.key}`, err);
    }
  }
  return items;
}

/** 刷新记分板上每个 AI 药物的登记库状态；升期 / 新试验写进历史并生成事件 */
export async function refreshMilestones(): Promise<number> {
  await connectToDatabase();
  const milestones = await FrontierMilestone.find({ status: 'active' });
  const today = new Date().toISOString().slice(0, 10);
  let changed = 0;
  for (const m of milestones) {
    const names = (m.aliases.length ? m.aliases : [m.drug]).map((a) => (/\s/.test(a) ? `"${a}"` : a));
    let studies: CtStudy[];
    try {
      studies = await query({ 'query.intr': names.join(' OR ') });
    } catch (err) {
      logError(`frontier:milestone:${m.drug}`, err);
      continue;
    }
    const trials: RegistryTrial[] = studies.map((s) => ({
      nctId: s.protocolSection.identificationModule.nctId,
      phases: s.protocolSection.designModule?.phases ?? [],
      status: s.protocolSection.statusModule?.overallStatus ?? '',
      primaryCompletion: s.protocolSection.statusModule?.primaryCompletionDateStruct?.date,
    }));
    const summary = summarizeRegistry(trials, today);
    const prev = m.registry;

    if (prev) {
      const newTrials = summary.nctIds.filter((id) => !prev.nctIds.includes(id));
      const notes: string[] = [];
      if (summary.maxPhase > prev.maxPhase) notes.push(`登记库最高阶段 ${phaseLabel(prev.maxPhase)} → ${phaseLabel(summary.maxPhase)}`);
      if (newTrials.length) notes.push(`新登记试验 ${newTrials.join(', ')}`);
      if (prev.leadStatus && summary.leadStatus && prev.leadStatus !== summary.leadStatus) {
        notes.push(`最高阶段试验状态 ${prev.leadStatus} → ${summary.leadStatus}`);
      }
      if (notes.length) {
        changed++;
        const text = notes.join('；');
        const url = newTrials[0] ? `https://clinicaltrials.gov/study/${newTrials[0]}` : `https://clinicaltrials.gov/search?intr=${encodeURIComponent(m.drug)}`;
        m.history.push({ at: new Date(), kind: 'phase', text, url });
        const phaseUp = summary.maxPhase > prev.maxPhase;
        // 进入三期是"AI 药能否被验证"的关键节点
        const importance = phaseUp && summary.maxPhase >= 3 ? 5 : phaseUp ? 4 : 3;
        const eventId = await createRuleEvent({
          title: `${m.drug} (${m.company}) registry update: ${text}`,
          titleZh: `AI 药物 ${m.drug}（${m.company}）：${text}`,
          eventType: 'ai-milestone',
          themes: ['ai-drug'],
          tickers: m.symbol ? [m.symbol] : [],
          importance,
          why: phaseUp ? 'AI 设计药物推进到更后期临床，是 AI 制药被验证的直接证据' : '登记库出现新试验或状态变化',
          source: 'trial',
          feed: 'ClinicalTrials.gov',
          url,
          publishedAt: new Date(),
          milestoneIds: [String(m._id)],
        });
        log('frontier:milestone', `${m.drug}: ${text}（事件 ${eventId}）`);
      }
    }
    m.registry = { ...summary, checkedAt: new Date() };
    await m.save();
  }
  return changed;
}

export async function collectTrials(ctx: SourceContext): Promise<{ items: NewFrontierItem[]; seen: number }> {
  const items = await collectThemeTrials(ctx);
  const changed = await refreshMilestones();
  log('frontier:trials', `主题新试验 ${items.length} 个，记分板变化 ${changed} 个`);
  return { items, seen: items.length };
}
