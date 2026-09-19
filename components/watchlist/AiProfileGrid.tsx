'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { BrainCircuit, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { refreshAiProfile } from '@/lib/actions/ai-profile.actions';
import { profileNeedsRefresh, rangePosition, SCORE_KEYS, type AiProfileData, type ScoreKey } from '@/lib/ai-profile-math';
import { formatNumber, isRedUpLocale } from '@/lib/utils';

export interface AiProfileCompany {
    symbol: string;
    name: string;
    logo?: string;
}

interface Props {
    companies: AiProfileCompany[];
    initial: AiProfileData[];
}

type CardStatus = 'idle' | 'loading' | 'failed';

// Cold watchlists generate every card; two LLM calls at a time keeps the
// page filling in without hammering the provider
const CONCURRENCY = 2;

const fmtPct = (v: number | null, digits = 1) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
const fmtRatio = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
const fmtDate = (iso: string, locale: string) =>
    new Date(iso).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export default function AiProfileGrid({ companies, initial }: Props) {
    const t = useTranslations('watchlist.aiProfile');
    const locale = useLocale();
    const redUp = isRedUpLocale(locale);

    const [profiles, setProfiles] = useState<Map<string, AiProfileData>>(() => new Map(initial.map((p) => [p.symbol, p])));
    const [status, setStatus] = useState<Map<string, CardStatus>>(() => new Map());
    const [noLlm, setNoLlm] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

    const setCardStatus = useCallback((symbol: string, s: CardStatus) => {
        setStatus((cur) => {
            const next = new Map(cur);
            if (s === 'idle') next.delete(symbol);
            else next.set(symbol, s);
            return next;
        });
    }, []);

    const runRefresh = useCallback(
        async (symbol: string, force: boolean) => {
            setCardStatus(symbol, 'loading');
            try {
                const out = await refreshAiProfile(symbol, { force });
                if (out.profile) {
                    const p = out.profile;
                    setProfiles((cur) => new Map(cur).set(p.symbol, p));
                }
                if (out.status === 'noLlm') setNoLlm(true);
                setCardStatus(symbol, out.status === 'ok' ? 'idle' : 'failed');
            } catch (e) {
                console.error('AI profile refresh failed', symbol, e);
                setCardStatus(symbol, 'failed');
            }
        },
        [setCardStatus],
    );

    // Mount-time backfill: anything missing or stale, a couple at a time
    const started = useRef(false);
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const queue = companies.map((c) => c.symbol).filter((s) => profileNeedsRefresh(profiles.get(s)));
        if (queue.length === 0) return;
        let cancelled = false;
        const worker = async () => {
            while (!cancelled) {
                const symbol = queue.shift();
                if (!symbol) return;
                await runRefresh(symbol, false);
            }
        };
        for (let i = 0; i < CONCURRENCY; i++) void worker();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadingCount = useMemo(() => [...status.values()].filter((s) => s === 'loading').length, [status]);
    const allExpanded = expanded.size === companies.length && companies.length > 0;
    const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(companies.map((c) => c.symbol)));
    const toggleOne = (symbol: string) =>
        setExpanded((cur) => {
            const next = new Set(cur);
            if (next.has(symbol)) next.delete(symbol);
            else next.add(symbol);
            return next;
        });

    if (companies.length === 0) return null;

    return (
        <section className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                        <BrainCircuit className="h-5 w-5 text-teal-400" />
                        {t('title')}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">{t('hint')}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                    {loadingCount > 0 && (
                        <span className="flex items-center gap-1.5 text-teal-300">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t('generating', { count: loadingCount })}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={toggleAll}
                        className="rounded-md border border-white/10 px-2.5 py-1 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        {allExpanded ? t('collapseAll') : t('expandAll')}
                    </button>
                </div>
            </div>

            {noLlm && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {t('noLlm')}{' '}
                    <Link href="/catalyst" className="underline underline-offset-2 hover:text-white">
                        {t('noLlmLink')}
                    </Link>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {companies.map((c) => (
                    <ProfileCard
                        key={c.symbol}
                        company={c}
                        profile={profiles.get(c.symbol) ?? null}
                        status={status.get(c.symbol) ?? 'idle'}
                        expanded={expanded.has(c.symbol)}
                        redUp={redUp}
                        locale={locale}
                        onToggle={() => toggleOne(c.symbol)}
                        onRefresh={() => runRefresh(c.symbol, true)}
                    />
                ))}
            </div>
        </section>
    );
}

// ── Card ──────────────────────────────────────────────────────────

interface CardProps {
    company: AiProfileCompany;
    profile: AiProfileData | null;
    status: CardStatus;
    expanded: boolean;
    redUp: boolean;
    locale: string;
    onToggle: () => void;
    onRefresh: () => void;
}

function ProfileCard({ company, profile, status, expanded, redUp, locale, onToggle, onRefresh }: CardProps) {
    const t = useTranslations('watchlist.aiProfile');
    const m = profile?.market ?? null;
    const pos = rangePosition(m);

    const stanceClass =
        profile?.stance === 'bullish'
            ? redUp ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : profile?.stance === 'bearish'
              ? redUp ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'
              : 'bg-white/5 text-gray-300 border-white/10';

    return (
        <article className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-5 shadow-lg backdrop-blur-md">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    {company.logo ? (
                        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/5 bg-white/10">
                            <Image src={company.logo} alt={company.symbol} fill className="object-contain p-1.5" />
                        </div>
                    ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-800 text-xs font-bold text-white">
                            {company.symbol[0]}
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/stocks/${company.symbol}`} className="truncate font-semibold text-white hover:underline">
                                {company.name || company.symbol}
                            </Link>
                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-gray-300">
                                {company.symbol}
                            </span>
                        </div>
                        {profile?.aiRole && (
                            <span className="mt-1 inline-block rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[11px] font-medium text-teal-300">
                                {profile.aiRole}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {profile && (
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${stanceClass}`}>
                            {t(`stance.${profile.stance}`)}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={status === 'loading'}
                        title={t('refresh')}
                        className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Body */}
            {!profile ? (
                <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
                    {status === 'loading' ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                            {t('cardGenerating')}
                        </>
                    ) : status === 'failed' ? (
                        t('cardFailed')
                    ) : (
                        t('cardPending')
                    )}
                </div>
            ) : (
                <>
                    {profile.summary && <p className="text-sm leading-relaxed text-gray-300">{profile.summary}</p>}

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                        {SCORE_KEYS.map((k) => (
                            <ScoreMeter key={k} dimension={k} score={profile[k].score} note={profile[k].note} full={expanded} />
                        ))}
                    </div>

                    {m && (
                        <div className="flex flex-wrap gap-2">
                            {([
                                ['ret13w', m.ret13w],
                                ['ret26w', m.ret26w],
                                ['retYtd', m.retYtd],
                                ['ret52w', m.ret52w],
                            ] as const).map(([k, v]) => (
                                <span key={k} className={`rounded-md px-2 py-1 text-xs font-medium tabular-nums ${signBg(v, redUp)}`}>
                                    <span className="mr-1 text-gray-400">{t(`returns.${k}`)}</span>
                                    {fmtPct(v)}
                                </span>
                            ))}
                        </div>
                    )}

                    {status === 'failed' && <p className="text-xs text-amber-300">{t('refreshFailed')}</p>}

                    <button
                        type="button"
                        onClick={onToggle}
                        className="flex w-fit items-center gap-1 text-xs font-medium text-gray-400 transition-colors hover:text-white"
                    >
                        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {expanded ? t('less') : t('more')}
                    </button>

                    {expanded && (
                        <div className="space-y-4 border-t border-white/10 pt-4">
                            {profile.highlights.length > 0 && (
                                <div>
                                    <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{t('highlights')}</h4>
                                    <ul className="mt-2 space-y-1.5 text-sm text-gray-300">
                                        {profile.highlights.map((h, i) => (
                                            <li key={i} className="flex gap-2">
                                                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                                                <span>{h}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div>
                                <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{t('capital')}</h4>
                                {m ? (
                                    <>
                                        <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
                                            <Metric label={t('metrics.marketCap')} value={formatNumber(m.marketCapUsdM)} />
                                            <Metric label={t('metrics.pe')} value={fmtRatio(m.peTtm)} />
                                            <Metric label={t('metrics.ps')} value={fmtRatio(m.psTtm)} />
                                            <Metric label={t('metrics.beta')} value={fmtRatio(m.beta, 2)} />
                                            <Metric label={t('metrics.revenueGrowth')} value={fmtPct(m.revenueGrowthTtm)} tone={signText(m.revenueGrowthTtm, redUp)} />
                                            <Metric label={t('metrics.netMargin')} value={fmtPct(m.netMarginTtm)} tone={signText(m.netMarginTtm, redUp)} />
                                        </div>
                                        {pos !== null && m.low52 !== null && m.high52 !== null && (
                                            <div className="mt-3">
                                                <div className="flex items-center justify-between text-[11px] text-gray-500">
                                                    <span>{t('range52.low')} {m.low52.toFixed(2)}</span>
                                                    <span>{t('range52.position', { pct: Math.round(pos * 100) })}</span>
                                                    <span>{t('range52.high')} {m.high52.toFixed(2)}</span>
                                                </div>
                                                <div className="relative mt-1.5 h-1.5 rounded-full bg-gradient-to-r from-gray-700 via-gray-600 to-teal-500/60">
                                                    <span
                                                        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-white shadow"
                                                        style={{ left: `${pos * 100}%` }}
                                                        title={m.price !== null ? m.price.toFixed(2) : undefined}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p className="mt-2 text-xs text-gray-500">{t('noMarket')}</p>
                                )}
                                {profile.capitalNote && <p className="mt-3 text-sm leading-relaxed text-gray-300">{profile.capitalNote}</p>}
                            </div>

                            <p className="text-[11px] text-gray-600">
                                {t('generatedAt', { date: fmtDate(profile.generatedAt, locale) })}
                                {profile.model ? ` · ${profile.model}` : ''}
                                {m ? ` · ${t('marketAt', { date: fmtDate(m.fetchedAt, locale) })}` : ''}
                            </p>
                        </div>
                    )}
                </>
            )}
        </article>
    );
}

function signBg(v: number | null, redUp: boolean): string {
    if (v === null || v === 0) return 'bg-white/5 text-gray-300';
    const up = v > 0;
    const red = 'bg-red-500/10 text-red-400';
    const green = 'bg-emerald-500/10 text-emerald-400';
    return (redUp ? up : !up) ? red : green;
}

function signText(v: number | null, redUp: boolean): string {
    if (v === null || v === 0) return 'text-white';
    const up = v > 0;
    return (redUp ? up : !up) ? 'text-red-400' : 'text-emerald-400';
}

function Metric({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
            <p className={`mt-0.5 text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
        </div>
    );
}

function ScoreMeter({ dimension, score, note, full }: { dimension: ScoreKey; score: number; note: string; full: boolean }) {
    const t = useTranslations('watchlist.aiProfile');
    return (
        <div title={note}>
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{t(`dimensions.${dimension}`)}</span>
                <span className="text-[11px] text-gray-500">{t(`levels.${score}`)}</span>
            </div>
            <div className="mt-1.5 flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                    <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${i <= score ? (score >= 4 ? 'bg-teal-400' : score === 3 ? 'bg-teal-400/60' : 'bg-gray-400/70') : 'bg-white/10'}`}
                    />
                ))}
            </div>
            {note && <p className={`mt-1.5 text-xs leading-snug text-gray-500 ${full ? '' : 'line-clamp-2'}`}>{note}</p>}
        </div>
    );
}
