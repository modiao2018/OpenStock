'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BrainCircuit, Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveLlmConfig, testLlm, type LlmConfigData } from '@/lib/actions/catalyst.actions';

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-2.5-flash-lite' },
    minimax: { baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3' },
    siray: { baseUrl: 'https://api.siray.ai/v1', model: 'siray-1.0-ultra' },
    custom: { baseUrl: '', model: '' },
};

export default function LlmConfigPanel({ initial }: { initial: LlmConfigData }) {
    const t = useTranslations('catalyst.llm');
    const router = useRouter();

    const [provider, setProvider] = useState<string>(initial.provider);
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
    const [model, setModel] = useState(initial.model);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const handleProviderChange = (name: string) => {
        setProvider(name);
        const defaults = PROVIDER_DEFAULTS[name];
        setBaseUrl(defaults?.baseUrl ?? '');
        setModel(defaults?.model ?? '');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveLlmConfig({
                provider: provider as LlmConfigData['provider'],
                apiKey: apiKey.trim() || undefined,
                baseUrl: baseUrl.trim() || undefined,
                model: model.trim() || undefined,
            });
            setApiKey('');
            toast.success(t('saved'));
            router.refresh();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const result = await testLlm();
            if (result.ok) {
                toast.success(t('testOk', { model: result.model ?? '', ms: result.latencyMs ?? 0 }));
            } else {
                toast.error(t('testFail', { error: result.error ?? '' }));
            }
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
                <BrainCircuit className="w-5 h-5 text-teal-500" />
                {t('title')}
            </h2>
            <p className="text-xs text-gray-600 mb-4">{initial.fromEnv ? t('fromEnv') : t('fromDb')}</p>

            <div className="space-y-3">
                <div className="space-y-1.5">
                    <Label htmlFor="llm-provider">{t('provider')}</Label>
                    <select
                        id="llm-provider"
                        value={provider}
                        onChange={(e) => handleProviderChange(e.target.value)}
                        className="w-full h-9 rounded-md bg-gray-800 border border-gray-700 px-3 text-sm text-gray-100"
                    >
                        <option value="gemini">Gemini</option>
                        <option value="minimax">MiniMax</option>
                        <option value="siray">Siray</option>
                        <option value="custom">{t('custom')}</option>
                    </select>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="llm-key">{t('apiKey')}</Label>
                    <Input
                        id="llm-key"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={initial.hasApiKey ? `${t('keyKept')} (${initial.apiKeyMasked})` : t('keyPlaceholder')}
                        autoComplete="off"
                        className="bg-gray-800 border-gray-700"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="llm-baseurl">Base URL</Label>
                    <Input
                        id="llm-baseurl"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                        className="bg-gray-800 border-gray-700"
                        disabled={provider === 'gemini'}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="llm-model">{t('model')}</Label>
                    <Input
                        id="llm-model"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="bg-gray-800 border-gray-700"
                    />
                </div>

                <div className="flex gap-2 pt-1">
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={saving || (provider === 'custom' && (!baseUrl.trim() || !model.trim()))}
                        className="flex-1 bg-teal-600 hover:bg-teal-500 text-white"
                    >
                        {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        {t('save')}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTest}
                        disabled={testing || !initial.hasApiKey}
                        className="flex-1 border-gray-700 text-gray-200"
                    >
                        {testing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PlugZap className="w-4 h-4 mr-1" />}
                        {t('test')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
