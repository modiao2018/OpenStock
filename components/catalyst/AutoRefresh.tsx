'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 定时刷新服务端数据——监控页要能自己长出新事件，不能靠手动刷新 */
export default function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
    const router = useRouter();
    useEffect(() => {
        const timer = setInterval(() => router.refresh(), intervalMs);
        return () => clearInterval(timer);
    }, [router, intervalMs]);
    return null;
}
