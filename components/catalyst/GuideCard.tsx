'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

const CATALYST_SECTIONS = ['why', 'watchlist', 'glossary', 'timeline', 'calendar', 'market'];

/**
 * 医药小白友好的页面使用指南——默认展开，收起状态记在 localStorage。
 * 文案在 `${namespace}.title` 与 `${namespace}.{key}Title/{key}Body`；glossary 一节占三行高。
 */
export default function GuideCard({
    namespace = 'catalyst.guide',
    sections: sectionKeys = CATALYST_SECTIONS,
    storageKey = 'catalyst-guide-collapsed',
}: {
    namespace?: string;
    sections?: string[];
    storageKey?: string;
}) {
    const t = useTranslations(namespace);
    const [open, setOpen] = useState(true);

    useEffect(() => {
        if (window.localStorage.getItem(storageKey) === '1') setOpen(false);
    }, [storageKey]);

    const toggle = () => {
        setOpen((prev) => {
            window.localStorage.setItem(storageKey, prev ? '1' : '0');
            return !prev;
        });
    };

    const sections = sectionKeys.map((key) => ({ key }));

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
