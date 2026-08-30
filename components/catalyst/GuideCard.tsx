'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

const STORAGE_KEY = 'catalyst-guide-collapsed';

/** 医药小白友好的页面使用指南——默认展开，收起状态记在 localStorage */
export default function GuideCard() {
    const t = useTranslations('catalyst.guide');
    const [open, setOpen] = useState(true);

    useEffect(() => {
        if (window.localStorage.getItem(STORAGE_KEY) === '1') setOpen(false);
    }, []);

    const toggle = () => {
        setOpen((prev) => {
            window.localStorage.setItem(STORAGE_KEY, prev ? '1' : '0');
            return !prev;
        });
    };

    const sections: Array<{ key: string }> = [
        { key: 'why' },
        { key: 'watchlist' },
        { key: 'glossary' },
        { key: 'timeline' },
        { key: 'calendar' },
        { key: 'market' },
    ];

    return (
        <div className="bg-teal-950/30 border border-teal-900/50 rounded-xl mb-8">
            <button
                type="button"
                onClick={toggle}
                className="w-full flex items-center justify-between p-4 text-left"
            >
                <span className="flex items-center gap-2 font-semibold text-teal-300">
                    <BookOpen className="w-5 h-5" />
                    {t('title')}
                </span>
                {open ? <ChevronUp className="w-4 h-4 text-teal-500" /> : <ChevronDown className="w-4 h-4 text-teal-500" />}
            </button>

            {open && (
                <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                    {sections.map(({ key }) => (
                        <div key={key} className={key === 'glossary' ? 'md:row-span-3' : ''}>
                            <h3 className="text-sm font-medium text-gray-200 mb-1">{t(`${key}Title`)}</h3>
                            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{t(`${key}Body`)}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
