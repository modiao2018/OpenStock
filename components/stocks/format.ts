/** Formatting helpers shared by the research cards. */

export function fmtMoney(value: number | null | undefined, digits: number = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(value);
}

export function fmtCompact(value: number | null | undefined, prefix: string = ''): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${prefix}${(abs / 1e3).toFixed(1)}K`;
    return `${sign}${prefix}${abs.toFixed(0)}`;
}

export function fmtPct(value: number | null | undefined, digits: number = 1, signed: boolean = true): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    const sign = signed && value > 0 ? '+' : '';
    return `${sign}${value.toFixed(digits)}%`;
}

/** Ratio (0.15) -> "+15.0%" */
export function fmtRatioPct(value: number | null | undefined, digits: number = 1, signed: boolean = true): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    return fmtPct(value * 100, digits, signed);
}

export function fmtShares(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function fmtDate(iso: string | null | undefined): string {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function signClass(value: number | null | undefined, neutral: string = 'text-gray-300'): string {
    if (value === null || value === undefined || value === 0) return neutral;
    return value > 0 ? 'text-emerald-400' : 'text-rose-400';
}
