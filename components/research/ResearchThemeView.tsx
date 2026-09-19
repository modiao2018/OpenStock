'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronUp, ClipboardList, ExternalLink, History, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import WatchlistButton from '@/components/WatchlistButton';
import { refreshResearchTheme } from '@/lib/actions/research.actions';
import type { WatchlistRow } from '@/lib/actions/finnhub.actions';
import type { ResearchThemeData } from '@/lib/research-math';
import type { ResearchSection, ResearchTierTone } from '@/database/models/research-theme.model';
import { formatCurrency, isRedUpLocale } from '@/lib/utils';

interface Props {
    theme: ResearchThemeData;
    initialQuotes: WatchlistRow[];
    inWatchlist: string[];
    userId: string;
    isAdmin: boolean;
}

const TONE_STYLES: Record<ResearchTierTone, { badge: string; bar: string }> = {
    core: { badge: 'border-teal-400/30 bg-teal-400/10 text-teal-300', bar: 'bg-teal-400' },
    validation: { badge: 'border-sky-400/30 bg-sky-400/10 text-sky-300', bar: 'bg-sky-400' },
    speculative: { badge: 'border-amber-400/30 bg-amber-400/10 text-amber-300', bar: 'bg-amber-400' },
    tools: { badge: 'border-violet-400/30 bg-violet-400/10 text-violet-300', bar: 'bg-violet-400' },
};

const GROUP_STYLES: Record<string, string> = {
    stable: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
    growth: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
    speculative: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    top: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
    tenx: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
};

const MOMENTUM_GROUP_STYLES: Record<string, string> = {
    strong: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    balanced: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
    event: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
};

const fmtSignedPct = (v: number | null, digits = 1) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);

const fmtDate = (iso: string, locale: string) =>
    new Date(iso).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export default function ResearchThemeView({ theme, initialQuotes, inWatchlist, userId, isAdmin }: Props) {
    const t = useTranslations('research');
    const locale = useLocale();
    const redUp = isRedUpLocale(locale);
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [showHistory, setShowHistory] = useState(false);
    const [watch, setWatch] = useState<Set<string>>(() => new Set(inWatchlist));
    const [quotes, setQuotes] = useState<Map<string, WatchlistRow>>(() => new Map(initialQuotes.map((q) => [q.symbol, q])));

    const symbols = useMemo(() => {
        const s = new Set<string>();
        for (const tier of theme.tiers) for (const e of tier.entries) s.add(e.symbol);
        return [...s];
    }, [theme]);

    // Live prices after mount; the SSR snapshot may be a session old
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const actions = await import('@/lib/actions/finnhub.actions');
                const rows = await actions.getWatchlistQuotes(symbols);
                if (cancelled || !rows?.length) return;
                setQuotes((cur) => {
                    const next = new Map(cur);
                    for (const r of rows) {
                        const prev = next.get(r.symbol);
                        next.set(r.symbol, { ...(prev ?? r), price: r.price ?? prev?.price ?? null, change: r.change ?? prev?.change ?? null, changePercent: r.changePercent ?? prev?.changePercent ?? null });
                    }
                    return next;
                });
            } catch (e) {
                console.error('research quotes refresh failed', e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbols]);

    const signClass = (v: number | null) => {
        if (v === null || v === 0) return 'text-gray-300';
        const up = v > 0;
        return (redUp ? up : !up) ? 'text-red-400' : 'text-emerald-400';
    };

    const nameOf = (symbol: string) => {
        for (const tier of theme.tiers) for (const e of tier.entries) if (e.symbol === symbol) return e.name;
        return symbol;
    };

    const onRefresh = () => {
        startTransition(async () => {
            const out = await refreshResearchTheme(theme.slug);
            if (out.status === 'updated') {
                toast.success(t('refreshResult.updated', { n: out.changes.length }));
                router.refresh();
            } else if (out.status === 'unchanged') {
                toast.success(t('refreshResult.unchanged'));
                router.refresh();
            } else if (out.status === 'noLlm') {
                toast.error(t('refreshResult.noLlm'));
            } else {
                toast.error(t('refreshResult.failed', { reason: out.reason }));
            }
        });
    };

    const QuotePill = ({ symbol }: { symbol: string }) => {
        const q = quotes.get(symbol);
        if (!q || q.price === null) return null;
        const pct = q.changePercent ?? 0;
        const up = pct >= 0;
        const cls = (redUp ? up : !up) ? 'text-red-400' : 'text-emerald-400';
        return (
            <span className="flex items-center gap-1.5 text-xs tabular-nums">
                <span className="text-gray-200">{formatCurrency(q.price)}</span>
                <span className={`flex items-center ${cls}`}>
                    {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {Math.abs(pct).toFixed(2)}%
                </span>
            </span>
        );
    };

    return (
        <section className="space-y-8">
            {/* Theme header */}
            <div className="rounded-2xl border border-white/10 bg-gray-950/40 p-6 backdrop-blur-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <h2 className="text-2xl font-semibold text-white">{theme.title}</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{theme.intro}</p>
                        <p className="mt-3 text-xs text-gray-500">
                            {t('meta.version', { n: theme.version })} · {t('meta.updatedAt', { date: fmtDate(theme.updatedAt, locale) })} · {t(`meta.by.${theme.updatedBy}`)}
                            {theme.checkedAt ? ` · ${t('meta.checkedAt', { date: fmtDate(theme.checkedAt, locale) })}` : ''}
                        </p>
                    </div>
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={onRefresh}
                            disabled={pending}
                            className="flex shrink-0 items-center gap-2 rounded-lg border border-teal-400/30 bg-teal-400/10 px-3 py-2 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-400/20 disabled:opacity-60"
                        >
                            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {pending ? t('refreshing') : t('refresh')}
                        </button>
                    )}
                </div>

                {theme.changes.length > 0 && (
                    <div className="mt-5 rounded-xl border border-white/5 bg-white/[0.03] p-4">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{t('changes.title')}</h3>
                        <ul className="mt-2 space-y-1 text-sm text-gray-300">
                            {theme.changes.map((c, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                                    <span>{c}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Framework sections placed above the shortlist */}
            {theme.sections.filter((sec) => sec.position === 'top').map((sec) => (
                <SectionBlock key={sec.key} section={sec} />
            ))}

            {/* Shortlist */}
            {theme.shortlist.symbols.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-6">
                    <h3 className="text-lg font-semibold text-white">{theme.shortlist.title || t('shortlist.title')}</h3>
                    <p className="mt-1 text-xs text-gray-500">{t('shortlist.hint')}</p>
                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
                        <ol className="space-y-2">
                            {theme.shortlist.symbols.map((s, i) => {
                                const reason = theme.shortlist.reasons.find((r) => r.symbol === s)?.reason ?? '';
                                return (
                                    <li key={s} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
                                        <span className="w-5 shrink-0 text-right font-mono text-sm text-gray-500">{i + 1}.</span>
                                        <Link href={`/stocks/${s}`} className="flex min-w-0 shrink-0 items-center gap-2 hover:underline">
                                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-gray-200">{s}</span>
                                            <span className="truncate text-sm font-medium text-white">{nameOf(s)}</span>
                                        </Link>
                                        <span className="min-w-0 flex-1 truncate text-sm text-gray-400" title={reason}>{reason}</span>
                                        <QuotePill symbol={s} />
                                    </li>
                                );
                            })}
                        </ol>
                        <div className="space-y-3">
                            {theme.shortlist.groups.map((g) => (
                                <div key={g.key} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                                    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${GROUP_STYLES[g.key] ?? 'border-white/10 bg-white/5 text-gray-200'}`}>
                                        {g.label}
                                    </span>
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {g.symbols.map((s) => (
                                            <Link key={s} href={`/stocks/${s}`} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-gray-200 hover:bg-white/10">
                                                {s}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    {theme.shortlist.note && <p className="mt-4 text-sm italic leading-relaxed text-gray-400">{theme.shortlist.note}</p>}
                </div>
            )}

            {/* Momentum snapshot */}
            {theme.momentum && (
                <div className="space-y-5 rounded-2xl border border-white/10 bg-black/40 p-6">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                                <TrendingUp className="h-5 w-5 text-teal-400" />
                                {theme.momentum.title || t('momentum.title')}
                            </h3>
                            <p className="mt-1 text-xs text-gray-500">
                                {t('momentum.window', { start: theme.momentum.windowStart, end: theme.momentum.windowEnd, n: theme.momentum.sessions })}
                                {theme.momentum.benchmarkSymbol && (
                                    <>
                                        {' · '}
                                        {t('momentum.benchmark', { symbol: theme.momentum.benchmarkSymbol })}{' '}
                                        <span className={signClass(theme.momentum.benchmarkReturnPct)}>{fmtSignedPct(theme.momentum.benchmarkReturnPct)}</span>
                                    </>
                                )}
                            </p>
                        </div>
                        <p className="text-[11px] text-gray-600">
                            {theme.momentum.computedAt ? t('momentum.computedAt', { date: fmtDate(theme.momentum.computedAt, locale) }) : t('momentum.seedNumbers')}
                        </p>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-white/10">
                        <table className="w-full min-w-[720px] text-left text-sm">
                            <thead className="bg-white/5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                <tr>
                                    <th className="px-4 py-3">{t('labels.company')}</th>
                                    <th className="px-4 py-3 text-right">{t('momentum.cols.return')}</th>
                                    <th className="px-4 py-3 text-right">{t('momentum.cols.drawdown')}</th>
                                    <th className="px-4 py-3">{t('momentum.cols.technical')}</th>
                                    <th className="px-4 py-3">{t('momentum.cols.verdict')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                                {theme.momentum.rows.map((r) => {
                                    const beat = r.returnPct !== null && theme.momentum!.benchmarkReturnPct !== null && r.returnPct > theme.momentum!.benchmarkReturnPct;
                                    return (
                                        <tr key={r.symbol} className="hover:bg-white/[0.03]">
                                            <td className="px-4 py-3">
                                                <Link href={`/stocks/${r.symbol}`} className="flex items-center gap-2 hover:underline">
                                                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-gray-200">{r.symbol}</span>
                                                    <span className="truncate text-gray-300">{nameOf(r.symbol)}</span>
                                                </Link>
                                            </td>
                                            <td className={`px-4 py-3 text-right font-semibold tabular-nums ${signClass(r.returnPct)}`}>
                                                {fmtSignedPct(r.returnPct)}
                                                {beat && <span className="ml-1 text-[10px] font-normal text-gray-500">{t('momentum.beat')}</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmtSignedPct(r.maxDrawdownPct)}</td>
                                            <td className="px-4 py-3 text-gray-300">
                                                <span className="mr-2 inline-flex gap-1 align-middle">
                                                    <MaDot label="20" above={r.aboveMa20} />
                                                    <MaDot label="50" above={r.aboveMa50} />
                                                </span>
                                                {r.technical}
                                            </td>
                                            <td className="px-4 py-3 text-gray-200">{r.verdict}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {theme.momentum.summary && <p className="text-sm leading-relaxed text-gray-300">{theme.momentum.summary}</p>}

                    {theme.momentum.groups.length > 0 && (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            {theme.momentum.groups.map((g) => (
                                <div key={g.key} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                                    <h4 className="text-sm font-semibold text-white">{g.title}</h4>
                                    {g.subtitle && <p className="mt-1 text-xs text-gray-500">{g.subtitle}</p>}
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {g.symbols.map((s) => (
                                            <Link key={s} href={`/stocks/${s}`} className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] hover:brightness-125 ${MOMENTUM_GROUP_STYLES[g.key] ?? 'border-white/10 bg-white/5 text-gray-200'}`}>
                                                {s}
                                            </Link>
                                        ))}
                                    </div>
                                    {g.note && <p className="mt-3 text-sm leading-relaxed text-gray-400">{g.note}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
                        {theme.momentum.ranking.length > 0 && (
                            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                                <h4 className="text-sm font-semibold text-white">{t('momentum.ranking')}</h4>
                                <p className="mt-1 text-xs text-gray-500">{t('momentum.rankingHint')}</p>
                                <ol className="mt-3 space-y-2">
                                    {theme.momentum.ranking.map((r, i) => (
                                        <li key={r.symbol} className="flex items-start gap-3 text-sm">
                                            <span className="w-5 shrink-0 text-right font-mono text-gray-500">{i + 1}.</span>
                                            <Link href={`/stocks/${r.symbol}`} className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-gray-200 hover:underline">
                                                {r.symbol}
                                            </Link>
                                            <span className="text-gray-300">{r.reason}</span>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        )}
                        {theme.momentum.spotlight && (
                            <div className="rounded-xl border border-teal-400/20 bg-teal-400/5 p-4">
                                <h4 className="flex items-center gap-2 text-sm font-semibold text-teal-200">
                                    {t('momentum.spotlight')}
                                    <Link href={`/stocks/${theme.momentum.spotlight.symbol}`} className="rounded-md border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 font-mono text-[11px] hover:underline">
                                        {theme.momentum.spotlight.symbol}
                                    </Link>
                                </h4>
                                <p className="mt-2 text-sm leading-relaxed text-gray-200">{theme.momentum.spotlight.text}</p>
                            </div>
                        )}
                    </div>

                    {theme.momentum.note && <p className="text-[11px] text-gray-600">{theme.momentum.note}</p>}
                </div>
            )}

            {/* Tiers */}
            {theme.tiers.map((tier) => {
                const tone = TONE_STYLES[tier.tone] ?? TONE_STYLES.core;
                return (
                    <div key={tier.key} className="space-y-3">
                        <div className="flex items-start gap-3">
                            <span className={`mt-1.5 h-5 w-1 rounded-full ${tone.bar}`} />
                            <div>
                                <h3 className="text-lg font-semibold text-white">{tier.title}</h3>
                                {tier.subtitle && <p className="mt-1 text-sm text-gray-400">{tier.subtitle}</p>}
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                            <div className={`hidden gap-4 border-b border-white/10 bg-white/5 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 md:grid ${hasRisk(tier) ? 'grid-cols-[minmax(220px,1.1fr)_2fr_1.4fr_auto]' : 'grid-cols-[minmax(220px,1.1fr)_3fr_auto]'}`}>
                                <span>{t('labels.company')}</span>
                                <span>{tier.thesisLabel || t('labels.thesis')}</span>
                                {hasRisk(tier) && <span>{tier.riskLabel || t('labels.risk')}</span>}
                                <span />
                            </div>
                            <ul className="divide-y divide-white/10">
                                {tier.entries.map((e) => (
                                    <li key={e.symbol} className={`grid grid-cols-1 gap-3 px-5 py-4 md:gap-4 ${hasRisk(tier) ? 'md:grid-cols-[minmax(220px,1.1fr)_2fr_1.4fr_auto]' : 'md:grid-cols-[minmax(220px,1.1fr)_3fr_auto]'}`}>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link href={`/stocks/${e.symbol}`} className="font-semibold text-white hover:underline">
                                                    {e.name}
                                                </Link>
                                                <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${tone.badge}`}>{e.symbol}</span>
                                                {e.tag && <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-300">{e.tag}</span>}
                                            </div>
                                            <div className="mt-1.5">
                                                <QuotePill symbol={e.symbol} />
                                            </div>
                                        </div>
                                        <p className="text-sm leading-relaxed text-gray-300">
                                            <span className="mr-1 text-xs text-gray-500 md:hidden">{tier.thesisLabel || t('labels.thesis')}：</span>
                                            {e.thesis}
                                        </p>
                                        {hasRisk(tier) && (
                                            <p className="text-sm leading-relaxed text-gray-400">
                                                {e.risk ? (
                                                    <>
                                                        <span className="mr-1 text-xs text-gray-500 md:hidden">{tier.riskLabel || t('labels.risk')}：</span>
                                                        {e.risk}
                                                    </>
                                                ) : (
                                                    <span className="text-gray-600">—</span>
                                                )}
                                            </p>
                                        )}
                                        <div className="flex items-start justify-end">
                                            <WatchlistButton
                                                symbol={e.symbol}
                                                company={e.name}
                                                isInWatchlist={watch.has(e.symbol)}
                                                type="icon"
                                                userId={userId}
                                                onWatchlistChange={(sym, added) =>
                                                    setWatch((cur) => {
                                                        const next = new Set(cur);
                                                        if (added) next.add(sym);
                                                        else next.delete(sym);
                                                        return next;
                                                    })
                                                }
                                            />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            {tier.note && (
                                <p className="border-t border-white/10 bg-white/[0.02] px-5 py-3 text-sm italic text-gray-300">{tier.note}</p>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Company tracking cards */}
            {theme.cards.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-start gap-3">
                        <span className="mt-1.5 h-5 w-1 rounded-full bg-teal-400" />
                        <div>
                            <h3 className="text-lg font-semibold text-white">{t('cards.title')}</h3>
                            <p className="mt-1 text-sm text-gray-400">{t('cards.hint')}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {theme.cards.map((c) => (
                            <article key={c.symbol} className="rounded-xl border border-white/10 bg-black/40 p-5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Link href={`/stocks/${c.symbol}`} className="rounded-md border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 font-mono text-xs text-teal-200 hover:underline">
                                        {c.symbol}
                                    </Link>
                                    <span className="font-semibold text-white">{nameOf(c.symbol)}</span>
                                    {c.title && <span className="text-sm text-gray-400">· {c.title}</span>}
                                    <span className="ml-auto"><QuotePill symbol={c.symbol} /></span>
                                </div>
                                <dl className="mt-4 space-y-3 text-sm">
                                    <CardField label={t('cards.coreAsset')} value={c.coreAsset} />
                                    <CardField label={t('cards.progress')} value={c.progress} empty={t('cards.noProgress')} />
                                    <CardField label={t('cards.catalysts')} value={c.catalysts} />
                                    <CardField label={t('cards.failConditions')} value={c.failConditions} tone="text-rose-200/90" />
                                    <CardField label={t('cards.verdict')} value={c.verdict} tone="text-white" />
                                </dl>
                            </article>
                        ))}
                    </div>
                </div>
            )}

            {theme.sections.filter((sec) => sec.position === 'bottom' && sec.key !== 'references').map((sec) => (
                <SectionBlock key={sec.key} section={sec} />
            ))}

            {/* Caveats */}
            {theme.caveats.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                        {t('caveats')}
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-amber-100/80">
                        {theme.caveats.map((c, i) => (
                            <li key={i}>· {c}</li>
                        ))}
                    </ul>
                </div>
            )}

            {theme.sections.filter((sec) => sec.position === 'bottom' && sec.key === 'references').map((sec) => (
                <SectionBlock key={sec.key} section={sec} />
            ))}

            {/* Revision history */}
            {theme.revisions.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowHistory((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-white"
                    >
                        <History className="h-3.5 w-3.5" />
                        {t('history.title', { n: theme.revisions.length })}
                        {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {showHistory && (
                        <ul className="mt-3 space-y-3">
                            {theme.revisions.map((r) => (
                                <li key={r.version} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-sm">
                                    <p className="text-xs text-gray-500">
                                        {t('meta.version', { n: r.version })} · {fmtDate(r.updatedAt, locale)} · {t(`meta.by.${r.updatedBy}`)}
                                    </p>
                                    <ul className="mt-1.5 space-y-1 text-gray-300">
                                        {r.changes.length > 0 ? r.changes.map((c, i) => <li key={i}>· {c}</li>) : <li className="text-gray-600">{t('history.noDetail')}</li>}
                                    </ul>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

function hasRisk(tier: { entries: { risk: string }[]; riskLabel: string }): boolean {
    return !!tier.riskLabel || tier.entries.some((e) => !!e.risk);
}

function CardField({ label, value, empty, tone = 'text-gray-300' }: { label: string; value: string; empty?: string; tone?: string }) {
    if (!value && !empty) return null;
    return (
        <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</dt>
            <dd className={`mt-1 leading-relaxed ${value ? tone : 'text-gray-600'}`}>{value || empty}</dd>
        </div>
    );
}

function SectionBlock({ section }: { section: ResearchSection }) {
    const Icon = section.key === 'references' ? BookOpen : ClipboardList;
    const List = section.style === 'numbered' ? 'ol' : 'ul';
    const listCls = section.style === 'numbered' ? 'list-decimal' : 'list-disc';
    return (
        <div className="rounded-2xl border border-white/10 bg-gray-950/40 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                <Icon className="h-5 w-5 text-teal-400" />
                {section.title}
            </h3>
            {section.intro && <p className="mt-2 text-sm text-gray-400">{section.intro}</p>}
            {section.items.length > 0 && (
                <List className={`mt-3 space-y-1.5 pl-5 text-sm leading-relaxed text-gray-300 ${listCls}`}>
                    {section.items.map((it, i) => (
                        <li key={i}>{it}</li>
                    ))}
                </List>
            )}
            {section.sub.length > 0 && (
                <div className={`mt-3 grid grid-cols-1 gap-4 ${section.sub.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
                    {section.sub.map((sub) => (
                        <div key={sub.title} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                            <h4 className="text-sm font-semibold text-white">{sub.title}</h4>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-300">
                                {sub.items.map((it, i) => (
                                    <li key={i}>{it}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
            {section.links.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                    {section.links.map((l) => (
                        <li key={l.url}>
                            <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-teal-300 hover:underline">
                                <ExternalLink className="h-3.5 w-3.5" />
                                {l.label}
                            </a>
                        </li>
                    ))}
                </ul>
            )}
            {section.outro && <p className="mt-3 text-sm leading-relaxed text-gray-300">{section.outro}</p>}
        </div>
    );
}

function MaDot({ label, above }: { label: string; above: boolean | null }) {
    const cls = above === null ? 'border-white/10 text-gray-600' : above ? 'border-teal-400/40 bg-teal-400/15 text-teal-300' : 'border-rose-400/40 bg-rose-400/10 text-rose-300';
    return (
        <span className={`rounded border px-1 text-[10px] font-mono leading-4 ${cls}`} title={`MA${label}`}>
            {label}
        </span>
    );
}
