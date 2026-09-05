'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronsRight, Loader2, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PIECE_SIZE, PUZZLE_HEIGHT, PUZZLE_WIDTH } from '@/lib/captcha/geometry';
import { requestCaptchaChallenge, submitCaptchaSolution } from '@/lib/actions/captcha.actions';
import type { CaptchaChallengePayload } from '@/lib/captcha/server';

type State = 'loading' | 'ready' | 'dragging' | 'verifying' | 'solved' | 'failed' | 'throttled' | 'unavailable';

type Props = {
    // Called with the single-use token once solved, and with null whenever
    // the widget resets (new puzzle, failure, refresh).
    onChange: (token: string | null) => void;
    error?: string;
    className?: string;
};

const HANDLE = 44; // px, matches .captcha-handle width
const TRAIL_CAP = 600;

const SlideCaptcha = ({ onChange, error, className }: Props) => {
    const t = useTranslations('auth.captcha');
    const [state, setState] = useState<State>('loading');
    const [challenge, setChallenge] = useState<CaptchaChallengePayload | null>(null);
    const [offset, setOffset] = useState(0);
    const [failReason, setFailReason] = useState<'mismatch' | 'trail' | 'expired' | null>(null);

    const trackRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ startX: number; startOffset: number; t0: number; trail: Array<{ t: number; x: number; y: number }> } | null>(null);
    const keyTrailRef = useRef<{ t0: number; points: Array<{ t: number; x: number; y: number }> } | null>(null);
    const offsetRef = useRef(0);
    const mountedRef = useRef(true);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const maxOffset = () => Math.max(0, (trackRef.current?.clientWidth ?? PUZZLE_WIDTH) - HANDLE);
    const scale = () => (trackRef.current?.clientWidth ?? PUZZLE_WIDTH) / PUZZLE_WIDTH;

    const setOffsetBoth = (v: number) => {
        offsetRef.current = v;
        setOffset(v);
    };

    // `keepNotice` leaves the last failure message on screen through the
    // reload; it clears on the next interaction so people have time to read it.
    const load = useCallback(async (keepNotice = false) => {
        setState('loading');
        setChallenge(null);
        setOffsetBoth(0);
        if (!keepNotice) setFailReason(null);
        keyTrailRef.current = null;
        onChangeRef.current(null);
        const res = await requestCaptchaChallenge();
        if (!mountedRef.current) return;
        if (!res.success) {
            setState(res.error === 'throttled' ? 'throttled' : 'unavailable');
            return;
        }
        setChallenge(res.challenge);
        setState('ready');
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void load();
        return () => {
            mountedRef.current = false;
        };
    }, [load]);

    const submit = useCallback(async (trail: Array<{ t: number; x: number; y: number }>) => {
        if (!challenge) return;
        const displayOffset = offsetRef.current;
        if (displayOffset < 4) {
            setOffsetBoth(0);
            setState('ready');
            return;
        }
        setState('verifying');
        const res = await submitCaptchaSolution({ id: challenge.id, x: displayOffset / scale(), trail });
        if (!mountedRef.current) return;
        if (res.ok) {
            setState('solved');
            onChangeRef.current(res.token);
            return;
        }
        setFailReason(res.reason);
        setState('failed');
        window.setTimeout(() => {
            if (mountedRef.current) void load(true);
        }, 1400);
    }, [challenge, load]);

    // ----- pointer drag -----
    const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (state !== 'ready') return;
        setFailReason(null);
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
            startX: e.clientX,
            startOffset: offsetRef.current,
            t0: performance.now(),
            trail: [{ t: 0, x: e.clientX, y: e.clientY }],
        };
        setState('dragging');
    };

    const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        const d = dragRef.current;
        if (!d) return;
        const next = Math.min(maxOffset(), Math.max(0, d.startOffset + (e.clientX - d.startX)));
        setOffsetBoth(next);
        if (d.trail.length < TRAIL_CAP) {
            d.trail.push({ t: Math.round(performance.now() - d.t0), x: Math.round(e.clientX), y: Math.round(e.clientY) });
        }
    };

    const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
        const d = dragRef.current;
        if (!d) return;
        dragRef.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // pointer already released
        }
        d.trail.push({ t: Math.round(performance.now() - d.t0), x: Math.round(e.clientX), y: Math.round(e.clientY) });
        void submit(d.trail);
    };

    // ----- keyboard -----
    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (state !== 'ready') return;
        setFailReason(null);
        const step = e.shiftKey ? 12 : 2;
        let next: number | null = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(maxOffset(), offsetRef.current + step);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, offsetRef.current - step);
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = maxOffset();
        if (next !== null) {
            e.preventDefault();
            setOffsetBoth(next);
            // keyboard users still produce a (sparse) trail so liveness passes
            const now = performance.now();
            const k = keyTrailRef.current ?? { t0: now, points: [{ t: 0, x: 0, y: 0 }] };
            keyTrailRef.current = k;
            if (k.points.length < TRAIL_CAP) k.points.push({ t: Math.round(now - k.t0), x: Math.round(next), y: 0 });
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const points = keyTrailRef.current?.points ?? [];
            keyTrailRef.current = null;
            void submit(points);
        }
    };

    const busy = state === 'loading' || state === 'verifying';
    const blocked = state === 'throttled' || state === 'unavailable';
    const trackWidth = trackRef.current?.clientWidth ?? PUZZLE_WIDTH;
    const fillScale = Math.min(1, (offset + HANDLE) / trackWidth);

    const failureText = failReason === 'expired' ? t('expired') : failReason ? t('failed') : '';
    const statusText = (() => {
        switch (state) {
            case 'verifying': return t('verifying');
            case 'solved': return t('solved');
            case 'failed': return failureText;
            case 'throttled': return t('throttled');
            case 'unavailable': return t('unavailable');
            // while a replacement puzzle loads, the last failure stays readable
            case 'loading': return failureText || t('loading');
            default: return failureText;
        }
    })();

    return (
        <div className={cn('captcha', className)} data-state={state}>
            <div className="captcha-stage" style={{ aspectRatio: `${PUZZLE_WIDTH} / ${PUZZLE_HEIGHT}` }}>
                {challenge ? (
                    <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={challenge.background} alt="" draggable={false} className="captcha-bg" />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={challenge.piece}
                            alt=""
                            draggable={false}
                            className="captcha-piece"
                            style={{
                                left: offset,
                                top: `${(challenge.y / PUZZLE_HEIGHT) * 100}%`,
                                width: `${(PIECE_SIZE / PUZZLE_WIDTH) * 100}%`,
                            }}
                        />
                    </>
                ) : (
                    <div className="captcha-skeleton" aria-hidden="true" />
                )}

                {blocked && (
                    <div className="captcha-veil">
                        <p>{statusText}</p>
                    </div>
                )}

                {state === 'solved' && (
                    <div className="captcha-veil captcha-veil-solved" aria-hidden="true">
                        <span className="captcha-badge"><Check className="size-4" strokeWidth={3} /></span>
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => void load()}
                    disabled={busy || state === 'dragging'}
                    className="captcha-refresh"
                    aria-label={t('refresh')}
                    title={t('refresh')}
                >
                    <RotateCw className="size-3.5" />
                </button>
            </div>

            <div ref={trackRef} className="captcha-track">
                <div className="captcha-fill" style={{ transform: `scaleX(${fillScale})` }} />
                <span className="captcha-hint" style={{ opacity: state === 'ready' ? Math.max(0, 1 - offset / 60) : 0 }}>
                    {t('hint')}
                </span>
                <button
                    type="button"
                    className="captcha-handle"
                    style={{ transform: `translateX(${offset}px)` }}
                    role="slider"
                    aria-label={t('handleLabel')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((offset / Math.max(1, maxOffset())) * 100)}
                    aria-disabled={state !== 'ready' && state !== 'dragging'}
                    disabled={busy || blocked || state === 'solved'}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={onKeyDown}
                >
                    {state === 'verifying' || state === 'loading' ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : state === 'solved' ? (
                        <Check className="size-4" strokeWidth={3} />
                    ) : state === 'failed' ? (
                        <X className="size-4" strokeWidth={3} />
                    ) : (
                        <ChevronsRight className="size-4" />
                    )}
                </button>
            </div>

            <p
                className={cn('captcha-status', failureText && state !== 'solved' && 'text-red-500')}
                role="status"
                aria-live="polite"
            >
                {error && state !== 'solved' ? <span className="text-red-500">{error}</span> : statusText}
            </p>
        </div>
    );
};

export default SlideCaptcha;
