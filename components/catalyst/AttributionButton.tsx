'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAttribution, type AttributionData } from '@/lib/actions/catalyst.actions';

function beijing(iso?: string): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const d = new Date(t + 8 * 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export default function AttributionButton({ eventId }: { eventId: string }) {
    const t = useTranslations('catalyst.attribution');
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<AttributionData | null>(null);

    const handleOpen = async () => {
        setOpen(true);
        if (data) return;
        setLoading(true);
        try {
            setData(await getAttribution(eventId));
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={handleOpen}
                className="text-xs text-gray-600 hover:text-teal-400 shrink-0"
                title={t('title')}
            >
                {t('button')}
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="bg-gray-900 border-gray-800 text-gray-100 max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <SearchCheck className="w-5 h-5 text-teal-500" />
                            {t('title')}
                        </DialogTitle>
                    </DialogHeader>

                    {loading && (
                        <div className="flex justify-center p-6">
                            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                        </div>
                    )}

                    {data && !data.available && (
                        <p className="text-sm text-gray-400">{t(`reason.${data.reason ?? 'error'}`)}</p>
                    )}

                    {data?.available && (
                        <div className="space-y-3 text-sm">
                            <div className="rounded-lg bg-gray-800/60 p-3">
                                {data.firstAbnormalAt && data.leadMinutes !== undefined ? (
                                    <p className={data.leadMinutes > 0 ? 'text-amber-300' : 'text-gray-200'}>
                                        {data.leadMinutes > 0
                                            ? t('verdictLead', { minutes: data.leadMinutes })
                                            : t('verdictNoLead')}
                                    </p>
                                ) : (
                                    <p className="text-gray-300">{t('verdictClean')}</p>
                                )}
                            </div>
                            <ul className="space-y-1 text-gray-400">
                                <li>{t('publishedAt')}: {beijing(data.publishedAt)}（北京时间）</li>
                                <li>{t('fetchedAt')}: {beijing(data.fetchedAt)}</li>
                                {data.firstAbnormalAt && (
                                    <li>{t('firstAbnormal')}: {beijing(data.firstAbnormalAt)}</li>
                                )}
                                <li>{t('maxZ')}: {data.maxZ}σ · {t('baseline')}: {data.baselineSamples}</li>
                            </ul>
                            {data.spikes && data.spikes.length > 0 && (
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">{t('spikes')}</p>
                                    <ul className="space-y-0.5 text-xs text-gray-400 font-mono">
                                        {data.spikes.map((s) => (
                                            <li key={s.t}>
                                                {beijing(s.t)}  {s.z > 0 ? '+' : ''}{s.z}σ  {s.retPct > 0 ? '+' : ''}{s.retPct}%  量比{s.rvol}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
