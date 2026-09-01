// Curated universe for the AI dips module. All symbols are US-listed (incl.
// ADRs) so the free Alpaca IEX feed covers them — no .HK/.SS suffixes.
// Company names are hardcoded to avoid ~40 Finnhub profile2 calls per cold
// load; sub-sector keys double as translation keys under `aiDips.subSectors`.

export type AiSubSector = 'chips' | 'infra' | 'cloud' | 'apps';

export interface AiDipMeta {
    symbol: string;
    name: string;
    subSector: AiSubSector;
}

export const AI_DIP_CATALOG: AiDipMeta[] = [
    // 芯片 / 半导体
    { symbol: 'NVDA', name: 'NVIDIA', subSector: 'chips' },
    { symbol: 'AMD', name: 'Advanced Micro Devices', subSector: 'chips' },
    { symbol: 'AVGO', name: 'Broadcom', subSector: 'chips' },
    { symbol: 'TSM', name: 'Taiwan Semiconductor', subSector: 'chips' },
    { symbol: 'ASML', name: 'ASML Holding', subSector: 'chips' },
    { symbol: 'ARM', name: 'Arm Holdings', subSector: 'chips' },
    { symbol: 'MU', name: 'Micron Technology', subSector: 'chips' },
    { symbol: 'MRVL', name: 'Marvell Technology', subSector: 'chips' },
    { symbol: 'QCOM', name: 'Qualcomm', subSector: 'chips' },
    { symbol: 'INTC', name: 'Intel', subSector: 'chips' },
    { symbol: 'TXN', name: 'Texas Instruments', subSector: 'chips' },
    { symbol: 'ALAB', name: 'Astera Labs', subSector: 'chips' },
    { symbol: 'CRDO', name: 'Credo Technology', subSector: 'chips' },
    // 算力硬件与基建
    { symbol: 'SMCI', name: 'Super Micro Computer', subSector: 'infra' },
    { symbol: 'DELL', name: 'Dell Technologies', subSector: 'infra' },
    { symbol: 'VRT', name: 'Vertiv Holdings', subSector: 'infra' },
    { symbol: 'ANET', name: 'Arista Networks', subSector: 'infra' },
    { symbol: 'COHR', name: 'Coherent', subSector: 'infra' },
    { symbol: 'CIEN', name: 'Ciena', subSector: 'infra' },
    { symbol: 'VST', name: 'Vistra', subSector: 'infra' },
    { symbol: 'CEG', name: 'Constellation Energy', subSector: 'infra' },
    { symbol: 'ETN', name: 'Eaton', subSector: 'infra' },
    // 云与软件
    { symbol: 'MSFT', name: 'Microsoft', subSector: 'cloud' },
    { symbol: 'GOOGL', name: 'Alphabet', subSector: 'cloud' },
    { symbol: 'AMZN', name: 'Amazon', subSector: 'cloud' },
    { symbol: 'META', name: 'Meta Platforms', subSector: 'cloud' },
    { symbol: 'ORCL', name: 'Oracle', subSector: 'cloud' },
    { symbol: 'NOW', name: 'ServiceNow', subSector: 'cloud' },
    { symbol: 'SNOW', name: 'Snowflake', subSector: 'cloud' },
    { symbol: 'DDOG', name: 'Datadog', subSector: 'cloud' },
    { symbol: 'PLTR', name: 'Palantir Technologies', subSector: 'cloud' },
    { symbol: 'MDB', name: 'MongoDB', subSector: 'cloud' },
    { symbol: 'CRM', name: 'Salesforce', subSector: 'cloud' },
    { symbol: 'NET', name: 'Cloudflare', subSector: 'cloud' },
    // AI 应用
    { symbol: 'TSLA', name: 'Tesla', subSector: 'apps' },
    { symbol: 'APP', name: 'AppLovin', subSector: 'apps' },
    { symbol: 'DUOL', name: 'Duolingo', subSector: 'apps' },
    { symbol: 'PATH', name: 'UiPath', subSector: 'apps' },
    { symbol: 'AI', name: 'C3.ai', subSector: 'apps' },
    { symbol: 'SOUN', name: 'SoundHound AI', subSector: 'apps' },
    { symbol: 'IOT', name: 'Samsara', subSector: 'apps' },
    { symbol: 'RDDT', name: 'Reddit', subSector: 'apps' },
];

export const AI_DIP_SYMBOLS: string[] = AI_DIP_CATALOG.map((s) => s.symbol);

export const AI_SUB_SECTORS: AiSubSector[] = ['chips', 'infra', 'cloud', 'apps'];
