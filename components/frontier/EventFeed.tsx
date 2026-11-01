'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BellPlus, Check, ChevronDown, ChevronUp, EyeOff, Newspaper, AlertTriangle, Link2 } from 'lucide-react';
import { addToCatalystWatch, dismissFrontierEvent, type FrontierEventData } from '@/lib/actions/frontier.actions';
import { formatTimeOfDay } from '@/lib/format-time';
import { isRedUpLocale } from '@/lib/utils';
import { Card, Stars, TYPE_BADGE, beijingDay, stanceClass } from './shared';

type Level = 'important' | 'notable' | 'all';
const MIN_BY_LEVEL: Record<Level, number> = { important: 4, notable: 3, all: 0 };

/** 受益/受损也是方向色：中文界面受益红、受损绿 */
function relationClass(relation: string, locale: string): string {
    if (relation === 'indirect') return 'border-gray-700 text-gray-300';
    const up = relation === 'direct';
    const red = 'border-red-800 text-red-300';
    const green = 'border-green-800 text-green-300';
    return isRedUpLocale(locale) === up ? red : green;
}

function EventCard({
    ev,
    themeNames,
    highlighted,
}: {
    ev: FrontierEventData;
    themeNames: Record<string, string>;
    highlighted: boolean;
}) {
    const t = useTranslations('frontier.feed');
    const tType = useTranslations('frontier.eventType');
    const locale = useLocale();
    const router = useRouter();
    const a = ev.analysis;
    const [open, setOpen] = useState(Boolean(a) && (ev.importance ?? 0) >= 4);
    const [showSources, setShowSources] = useState(false);
    const [watchMenu, setWatchMenu] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const primaryUrl = ev.sources.find((s) => s.url)?.url ?? null;
    const watchCandidates = useMemo(() => {
        const names = new Map<string, string>();
        for (const b of a?.beneficiaries ?? []) if (b.relation !== 'indirect') names.set(b.symbol, b.name);
        for (const s of ev.tickers) if (!names.has(s)) names.set(s, '');
        return [...names.entries()];
    }, [a, ev.tickers]);

    const addWatch = async (symbol: string, name: string) => {
        setBusy(symbol);
        try {
            const r = await addToCatalystWatch(symbol, name);
            toast.success(r.status === 'added' ? t('watchAdded', { symbol }) : t('watchExists', { symbol }));
            setWatchMenu(false);
        } catch {
            toast.error(t('actionFailed'));
        } finally {
            setBusy(null);
        }
    };

    const dismiss = async () => {
        setBusy('dismiss');
        try {
            await dismissFrontierEvent(ev.id);
            router.refresh();
        } catch {
            toast.error(t('actionFailed'));
            setBusy(null);
        }
    };

    return (
        <li id={`ev-${ev.id}`} className={`rounded-lg border p-3 ${highlighted ? 'border-teal-600 bg-teal-950/20' : 'border-gray-800/80 bg-gray-950/40'}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-600 tabular-nums">{formatTimeOfDay(ev.firstSeenAt, locale)}</span>
                <Stars n={ev.importance} />
                <span className={`px-1.5 py-0.5 rounded ${TYPE_BADGE[ev.eventType] ?? TYPE_BADGE.other}`}>{tType(ev.eventType)}</span>
                {ev.themes.map((k) => (
                    <span key={k} className="px-1.5 py-0.5 rounded bg-gray-800/80 text-gray-400">{themeNames[k] ?? k}</span>
                ))}
                {ev.triageMode === 'rule' && <span className="text-gray-600" title={t('ruleHint')}>{t('rule')}</span>}
                {ev.pushed && <span className="text-teal-500">{t('pushed')}</span>}
            </div>

            <div className="mt-1.5">
                {primaryUrl ? (
                    <a href={primaryUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-100 hover:text-teal-400 leading-snug">
                        {ev.titleZh}
                    </a>
                ) : (
                    <span className="text-sm text-gray-100 leading-snug">{ev.titleZh}</span>
                )}
                {ev.titleZh !== ev.title && <p className="text-xs text-gray-600 mt-0.5 truncate" title={ev.title}>{ev.title}</p>}
            </div>

            {!open && (ev.why || a?.summary) && <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{a?.summary || ev.why}</p>}

            {open && a && (
                <div className="mt-2.5 space-y-2.5 text-xs leading-relaxed">
                    <p className="text-gray-200">{a.summary}</p>
                    {!a.fullText && <p className="text-amber-500/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t('snippetOnly')}</p>}
                    {a.facts.length > 0 && (
                        <div>
                            <h4 className="text-gray-500 mb-1">{t('facts')}</h4>
                            <ul className="space-y-1">
                                {a.facts.map((f, i) => (
                                    <li key={i} className="flex gap-2" title={f.quote}>
                                        {f.verified ? (
                                            <span className="shrink-0 text-teal-400" title={t('verifiedHint')}><Check className="w-3.5 h-3.5 mt-px" /></span>
                                        ) : (
                                            <span className="shrink-0 text-amber-400 whitespace-nowrap">{t('unverified')}</span>
                                        )}
                                        <span className="text-gray-300">{f.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {a.interpretation && (
                        <div>
                            <h4 className="text-gray-500 mb-1 flex items-center gap-2">
                                {t('interpretation')}
                                <span className={`px-1.5 py-0.5 rounded ${stanceClass(a.stance, locale)}`}>{t(`stance.${a.stance}`)}</span>
                            </h4>
                            <p className="text-gray-300">{a.interpretation}</p>
                        </div>
                    )}
                    {a.beneficiaries.length > 0 && (
                        <div>
                            <h4 className="text-gray-500 mb-1">{t('chain')}</h4>
                            <div className="flex flex-wrap gap-1.5">
                                {a.beneficiaries.map((b) => (
                                    <Link
                                        key={b.symbol}
                                        href={`/stocks/${b.symbol}`}
                                        title={b.reason}
                                        className={`px-2 py-0.5 rounded border ${relationClass(b.relation, locale)} hover:bg-gray-800`}
                                    >
                                        {t(`relation.${b.relation}`)} · {b.symbol}
                                        {b.reason && <span className="text-gray-500 ml-1">{b.reason}</span>}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                    {a.glossary.length > 0 && (
                        <div className="rounded bg-gray-900/80 p-2 text-gray-400">
                            {a.glossary.map((g) => (
                                <p key={g.term}>
                                    <span className="text-gray-200">{g.term}</span>：{g.explain}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500">
                {ev.tickers.slice(0, 6).map((s) => (
                    <Link key={s} href={`/stocks/${s}`} className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 hover:text-teal-400" title={t('tickerHint')}>
                        {s}
                    </Link>
                ))}
                <button type="button" onClick={() => setShowSources((v) => !v)} className="flex items-center gap-1 hover:text-gray-300">
                    <Newspaper className="w-3.5 h-3.5" />
                    {t('sources', { n: ev.sourceCount })}
                </button>
                {a && (
                    <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 hover:text-gray-300">
                        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {open ? t('collapse') : t('expand')}
                    </button>
                )}
                {watchCandidates.length > 0 && (
                    <span className="relative">
                        <button type="button" onClick={() => setWatchMenu((v) => !v)} className="flex items-center gap-1 hover:text-gray-300">
                            <BellPlus className="w-3.5 h-3.5" />
                            {t('addWatch')}
                        </button>
                        {watchMenu && (
                            <span className="absolute z-10 left-0 top-5 flex flex-col min-w-36 rounded-md border border-gray-700 bg-gray-900 p-1 shadow-xl">
                                {watchCandidates.map(([sym, name]) => (
                                    <button
                                        key={sym}
                                        type="button"
                                        disabled={busy !== null}
                                        onClick={() => addWatch(sym, name)}
                                        className="text-left px-2 py-1 rounded hover:bg-gray-800 text-gray-200"
                                    >
                                        {sym}
                                        {name && <span className="text-gray-500 ml-1.5">{name}</span>}
                                    </button>
                                ))}
                            </span>
                        )}
                    </span>
                )}
                <button type="button" onClick={dismiss} disabled={busy !== null} className="ml-auto flex items-center gap-1 hover:text-gray-300" title={t('dismissHint')}>
                    <EyeOff className="w-3.5 h-3.5" />
                    {t('dismiss')}
                </button>
            </div>

            {showSources && (
                <ul className="mt-2 space-y-1 border-t border-gray-800 pt-2 text-xs">
                    {ev.sources.map((s, i) => (
                        <li key={i} className="flex gap-2">
                            <span className="shrink-0 text-gray-500">{s.feed}</span>
                            {s.url ? (
                                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-teal-400 truncate flex items-center gap-1">
                                    <Link2 className="w-3 h-3 shrink-0" />
                                    {s.title}
                                </a>
                            ) : (
                                <span className="text-gray-300 truncate">{s.title}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

/** 事件流：按北京日期分组；默认只看 3 星以上，可切到只看重要或全部；类型可筛选 */
export default function EventFeed({
    events,
    themeNames,
    activeTheme,
    highlightId,
}: {
    events: FrontierEventData[];
    themeNames: Record<string, string>;
    activeTheme: string | null;
    highlightId: string | null;
}) {
    const t = useTranslations('frontier.feed');
    const tType = useTranslations('frontier.eventType');
    const locale = useLocale();
    const [level, setLevel] = useState<Level>('notable');
    const [type, setType] = useState<string | null>(null);

    useEffect(() => {
        if (highlightId) document.getElementById(`ev-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [highlightId]);

    const types = useMemo(() => [...new Set(events.map((e) => e.eventType))], [events]);
    const groups = useMemo(() => {
        const min = MIN_BY_LEVEL[level];
        const filtered = events.filter(
            (e) => (e.id === highlightId || (e.importance ?? 0) >= min) && (type === null || e.eventType === type),
        );
        const byDay = new Map<string, FrontierEventData[]>();
        for (const e of filtered) {
            const day = beijingDay(e.firstSeenAt, locale);
            (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(e);
        }
        // 同一天内重要的排前面
        for (const list of byDay.values()) list.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
        return [...byDay.entries()];
    }, [events, level, type, locale, highlightId]);

    const chip = (active: boolean) =>
        `text-xs px-2.5 py-1 rounded-full border ${active ? 'border-teal-600 bg-teal-950/60 text-teal-300' : 'border-gray-800 text-gray-500 hover:text-gray-300'}`;

    return (
        <Card
            title={activeTheme ? t('titleTheme', { theme: themeNames[activeTheme] ?? activeTheme }) : t('title')}
            icon={<Newspaper className="w-5 h-5 text-teal-500" />}
            hint={t('hint')}
        >
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
                {(['important', 'notable', 'all'] as Level[]).map((l) => (
                    <button key={l} type="button" className={chip(level === l)} onClick={() => setLevel(l)}>
                        {t(`level.${l}`)}
                    </button>
                ))}
                <span className="w-px h-4 bg-gray-800 mx-1" />
                <button type="button" className={chip(type === null)} onClick={() => setType(null)}>
                    {t('allTypes')}
                </button>
                {types.map((k) => (
                    <button key={k} type="button" className={chip(type === k)} onClick={() => setType(type === k ? null : k)}>
                        {tType(k)}
                    </button>
                ))}
            </div>

            {groups.length === 0 ? (
                <p className="text-gray-500 text-sm">{events.length === 0 ? t('emptyNoData') : t('emptyFiltered')}</p>
            ) : (
                <div className="space-y-5">
                    {groups.map(([day, list]) => (
                        <div key={day}>
                            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2.5">{day}</h3>
                            <ul className="space-y-2.5">
                                {list.map((ev) => (
                                    <EventCard key={ev.id} ev={ev} themeNames={themeNames} highlighted={ev.id === highlightId} />
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}
