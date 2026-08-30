'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Activity, BellRing, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    sendSimulatedAlert,
    sendTestPush,
    type MonitorStatusData,
    type SimulatedKind,
} from '@/lib/actions/catalyst.actions';

const SIM_KINDS: SimulatedKind[] = ['market', 'halts', 'edgar', 'clinicaltrials', 'rss', 'reminder', 'weekly'];

function formatTime(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function MonitorDebugPanel({ status }: { status: MonitorStatusData }) {
    const t = useTranslations('catalyst.debug');
    const tSource = useTranslations('catalyst.timeline.source');
    const [testing, setTesting] = useState(false);
    const [simulating, setSimulating] = useState<SimulatedKind | null>(null);

    const handleSimulate = async (kind: SimulatedKind) => {
        setSimulating(kind);
        try {
            const result = await sendSimulatedAlert(kind);
            if (result.delivered) toast.success(t('simSent', { kind: t(`sim.${kind}`) }));
            else toast.error(t('simFailed'));
        } catch {
            toast.error(t('simFailed'));
        } finally {
            setSimulating(null);
        }
    };

    const channelLabel = (configured: boolean) => (
        <span className={configured ? 'text-teal-400' : 'text-gray-600'}>
            {configured ? t('configured') : t('notConfigured')}
        </span>
    );

    const handleTestPush = async () => {
        setTesting(true);
        try {
            const result = await sendTestPush();
            const describe = (r: string) =>
                r === 'ok' ? t('pushOk') : r === 'fail' ? t('pushFail') : t('notConfigured');
            const summary = `Bark: ${describe(result.bark)}`;
            if (result.bark === 'ok') toast.success(summary);
            else toast.error(summary);
        } catch {
            toast.error(t('pushFail'));
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="w-5 h-5 text-teal-500" />
                    {t('title')}
                </h2>
                <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                        status.daemonOnline ? 'bg-teal-900/60 text-teal-300' : 'bg-red-900/50 text-red-300'
                    }`}
                >
                    ● {status.daemonOnline ? t('online') : t('offline')}
                </span>
            </div>

            {/* 采集器频率与心跳 */}
            <div className="mb-4">
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{t('collectors')}</h3>
                <ul className="space-y-1.5">
                    {status.collectors.map((c) => (
                        <li key={c.name} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${c.active ? 'bg-teal-400' : 'bg-gray-600'}`} />
                                <span className="text-gray-300">{tSource(c.name)}</span>
                                <span className="text-xs text-gray-600">{t('every', { minutes: c.intervalMinutes })}</span>
                            </span>
                            <span className="text-xs text-gray-500" title={t('lastRun')}>
                                {c.lastRun ? formatTime(c.lastRun) : t('never')}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>

            {/* 推送渠道 */}
            <div className="mb-4">
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{t('channels')}</h3>
                <ul className="space-y-1 text-sm text-gray-300">
                    <li className="flex justify-between"><span>Bark</span>{channelLabel(status.channels.bark)}</li>
                    <li className="flex justify-between"><span>{t('edgarContact')}</span>{channelLabel(status.channels.edgarContact)}</li>
                </ul>
            </div>

            <Button
                size="sm"
                variant="outline"
                onClick={handleTestPush}
                disabled={testing || !status.channels.bark}
                className="w-full border-gray-700 text-gray-200"
            >
                {testing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <BellRing className="w-4 h-4 mr-1" />}
                {t('testPush')}
            </Button>

            {/* 每种监控场景的模拟发送——预览各类告警在手机上的样子 */}
            <div className="mt-4">
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-1">{t('simTitle')}</h3>
                <p className="text-xs text-gray-600 mb-2">{t('simNote')}</p>
                <div className="grid grid-cols-2 gap-1.5">
                    {SIM_KINDS.map((kind) => (
                        <Button
                            key={kind}
                            size="sm"
                            variant="outline"
                            onClick={() => handleSimulate(kind)}
                            disabled={simulating !== null || !status.channels.bark}
                            className="border-gray-700 text-gray-300 h-7 text-xs justify-start"
                        >
                            {simulating === kind ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : null}
                            {t(`sim.${kind}`)}
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    );
}
