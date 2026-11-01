import type { ThemeTicker } from '@/lib/frontier-math';

/**
 * 生物科技前沿的种子数据：首次运行时写入数据库，此后以网页端编辑为准。
 * 种子由 AI 整理（2026-11），可能有遗漏或过时——标的、关键词都能在页面上改；
 * AI 药物的临床阶段不靠这里，由 ClinicalTrials.gov 实时计算。
 */

export interface SeedTheme {
    key: string;
    name: string;
    nameEn: string;
    description: string;
    keywords: string[];
    /** ClinicalTrials.gov 新试验检索词（空 = 该主题不按试验检索） */
    trialQuery?: { field: 'query.intr' | 'query.cond'; term: string };
    tickers: ThemeTicker[];
}

export const SEED_THEMES: SeedTheme[] = [
    {
        key: 'ai-drug',
        name: 'AI 制药',
        nameEn: 'AI drug discovery',
        description: '用 AI 找靶点、设计分子或抗体，目标是把新药研发从 10 年、几十亿美元压缩下来。目前最关键的验证点：AI 设计的药能否在三期临床里跑赢传统药。',
        keywords: [
            'artificial intelligence', 'machine learning', 'deep learning', 'generative AI', 'AI-designed',
            'AI-discovered', 'AI-driven', 'AI-enabled drug', 'AI drug discovery', 'foundation model', 'AlphaFold',
            'in silico', 'computational drug', 'large language model', 'protein design', 'Isomorphic',
            'Xaira', 'Insilico', 'Generate Biomedicines', 'Iambic', 'BioNeMo', 'AI',
        ],
        tickers: [
            { symbol: 'RXRX', company: 'Recursion Pharmaceuticals', tier: 'pure', aliases: ['Recursion', 'Exscientia'] },
            { symbol: 'SDGR', company: 'Schrödinger', tier: 'pure', aliases: ['Schrodinger'] },
            { symbol: 'ABSI', company: 'Absci', tier: 'pure' },
            { symbol: 'ABCL', company: 'AbCellera Biologics', tier: 'pure', aliases: ['AbCellera'] },
            { symbol: 'RLAY', company: 'Relay Therapeutics', tier: 'pure' },
            { symbol: 'LLY', company: 'Eli Lilly and Company', tier: 'pharma', aliases: ['Lilly'] },
            { symbol: 'NVS', company: 'Novartis', tier: 'pharma' },
            { symbol: 'AZN', company: 'AstraZeneca', tier: 'pharma' },
            { symbol: 'SNY', company: 'Sanofi', tier: 'pharma' },
            { symbol: 'TAK', company: 'Takeda Pharmaceutical', tier: 'pharma', aliases: ['Takeda'] },
            { symbol: 'NVDA', company: 'NVIDIA', tier: 'tools', aliases: ['Nvidia'] },
            { symbol: 'GOOGL', company: 'Alphabet', tier: 'tools', aliases: ['Isomorphic Labs', 'Google DeepMind'] },
        ],
    },
    {
        key: 'ai-dx',
        name: 'AI 诊断与医疗数据',
        nameEn: 'AI diagnostics & health data',
        description: '用 AI 读病理切片、基因测序和血液检测数据，更早、更准地发现癌症等疾病；也包括卖医疗数据给药企做研发的公司。',
        keywords: [
            'digital pathology', 'AI diagnostic', 'liquid biopsy', 'multi-cancer early detection', 'MCED',
            'genomic profiling', 'real-world data', 'clinical AI', 'AI-enabled device', 'precision medicine',
        ],
        tickers: [
            { symbol: 'TEM', company: 'Tempus AI', tier: 'pure', aliases: ['Tempus'] },
            { symbol: 'GH', company: 'Guardant Health', tier: 'pure', aliases: ['Guardant'] },
            { symbol: 'GRAL', company: 'GRAIL', tier: 'pure', aliases: ['Galleri'] },
            { symbol: 'NTRA', company: 'Natera', tier: 'pure' },
            { symbol: 'ILMN', company: 'Illumina', tier: 'tools' },
        ],
    },
    {
        key: 'obesity',
        name: '减重药（GLP-1）',
        nameEn: 'Obesity (GLP-1)',
        description: 'GLP-1 类药物（司美格鲁肽、替尔泊肽等）开创了减重药市场，是近年医药最大的赛道。看点：口服药、更少肌肉流失、更长效、新适应症。',
        keywords: [
            'GLP-1', 'obesity', 'weight loss', 'semaglutide', 'tirzepatide', 'retatrutide', 'orforglipron',
            'amylin', 'CagriSema', 'Wegovy', 'Zepbound', 'incretin', 'MariTide', 'weight management',
        ],
        trialQuery: { field: 'query.cond', term: 'obesity OR overweight' },
        tickers: [
            { symbol: 'LLY', company: 'Eli Lilly and Company', tier: 'pharma', aliases: ['Lilly'] },
            { symbol: 'NVO', company: 'Novo Nordisk', tier: 'pharma' },
            { symbol: 'AMGN', company: 'Amgen', tier: 'pharma' },
            { symbol: 'PFE', company: 'Pfizer', tier: 'pharma' },
            { symbol: 'VKTX', company: 'Viking Therapeutics', tier: 'pure' },
            { symbol: 'GPCR', company: 'Structure Therapeutics', tier: 'pure' },
            { symbol: 'ALT', company: 'Altimmune', tier: 'pure' },
        ],
    },
    {
        key: 'adc',
        name: 'ADC 靶向药',
        nameEn: 'Antibody-drug conjugates',
        description: 'ADC = 抗体 + 化疗药，用抗体把毒药精准送到癌细胞上，被称为"生物导弹"。是大药企并购和中国药企授权出海最热的方向之一。',
        keywords: ['antibody-drug conjugate', 'antibody drug conjugate', 'ADC', 'ADCs', 'Enhertu', 'Trodelvy', 'datopotamab', 'bispecific ADC'],
        trialQuery: { field: 'query.intr', term: 'antibody-drug conjugate OR antibody drug conjugate' },
        tickers: [
            { symbol: 'AZN', company: 'AstraZeneca', tier: 'pharma' },
            { symbol: 'PFE', company: 'Pfizer', tier: 'pharma' },
            { symbol: 'MRK', company: 'Merck & Co.', tier: 'pharma', aliases: ['Merck'] },
            { symbol: 'ABBV', company: 'AbbVie', tier: 'pharma' },
            { symbol: 'GILD', company: 'Gilead Sciences', tier: 'pharma', aliases: ['Gilead'] },
            { symbol: 'ZYME', company: 'Zymeworks', tier: 'pure' },
        ],
    },
    {
        key: 'gene-cell',
        name: '基因编辑与细胞疗法',
        nameEn: 'Gene editing & cell therapy',
        description: '直接修改致病基因（CRISPR 等），或改造免疫细胞去杀癌细胞（CAR-T）。看点：一次治愈、从体外改造走向体内直接改造（更便宜）。',
        keywords: [
            'CRISPR', 'gene editing', 'base editing', 'prime editing', 'gene therapy', 'CAR-T', 'CAR T',
            'cell therapy', 'in vivo CAR-T', 'Casgevy', 'epigenetic editing', 'TCR-T',
        ],
        trialQuery: { field: 'query.intr', term: 'CRISPR OR base editing OR prime editing OR CAR-T OR in vivo gene editing' },
        tickers: [
            { symbol: 'CRSP', company: 'CRISPR Therapeutics', tier: 'pure' },
            { symbol: 'NTLA', company: 'Intellia Therapeutics', tier: 'pure', aliases: ['Intellia'] },
            { symbol: 'BEAM', company: 'Beam Therapeutics', tier: 'pure' },
            { symbol: 'PRME', company: 'Prime Medicine', tier: 'pure' },
            { symbol: 'LEGN', company: 'Legend Biotech', tier: 'pure' },
            { symbol: 'VRTX', company: 'Vertex Pharmaceuticals', tier: 'pharma', aliases: ['Vertex'] },
            { symbol: 'BMY', company: 'Bristol Myers Squibb', tier: 'pharma', aliases: ['Bristol-Myers Squibb'] },
            { symbol: 'GILD', company: 'Gilead Sciences', tier: 'pharma', aliases: ['Gilead', 'Kite Pharma'] },
        ],
    },
    {
        key: 'china-out',
        name: '中国创新药出海',
        nameEn: 'China biotech out-licensing',
        description: '中国药企把自研新药的海外权利授权给欧美药企，已占全球大额授权交易的相当比例。美股里受影响的是买方大药企和合作方。',
        keywords: [
            'Hengrui', 'Akeso', 'Innovent', 'Hansoh', 'Kelun', 'CSPC', 'Sino Biopharm', '3SBio', 'Duality Bio',
            'BioKin', 'Hutchmed', 'China-based', 'Chinese biotech',
        ],
        tickers: [
            { symbol: 'SMMT', company: 'Summit Therapeutics', tier: 'pure', aliases: ['ivonescimab'] },
            { symbol: 'ZLAB', company: 'Zai Lab', tier: 'pure' },
            { symbol: 'ONC', company: 'BeOne Medicines', tier: 'pure', aliases: ['BeiGene'] },
            { symbol: 'LEGN', company: 'Legend Biotech', tier: 'pure' },
            { symbol: 'MRK', company: 'Merck & Co.', tier: 'pharma', aliases: ['Merck'] },
            { symbol: 'PFE', company: 'Pfizer', tier: 'pharma' },
            { symbol: 'GSK', company: 'GSK', tier: 'pharma', aliases: ['GlaxoSmithKline'] },
        ],
    },
];

export interface SeedMilestone {
    drug: string;
    /** ClinicalTrials.gov 检索用的全部名称（代号、通用名、旧代号） */
    aliases: string[];
    company: string;
    symbol: string | null;
    approach: string;
    indication: string;
}

export const SEED_MILESTONES: SeedMilestone[] = [
    { drug: 'rentosertib', aliases: ['rentosertib', 'INS018_055', 'ISM001-055'], company: 'Insilico Medicine', symbol: null, approach: '生成式 AI 同时找靶点（TNIK）和设计分子', indication: '特发性肺纤维化' },
    { drug: 'ISM3412', aliases: ['ISM3412'], company: 'Insilico Medicine', symbol: null, approach: '生成式 AI 分子设计（MAT2A 抑制剂）', indication: 'MTAP 缺失实体瘤' },
    { drug: 'ISM5411', aliases: ['ISM5411'], company: 'Insilico Medicine', symbol: null, approach: '生成式 AI 分子设计（肠道限制性 PHD 抑制剂）', indication: '炎症性肠病' },
    { drug: 'ISM6331', aliases: ['ISM6331'], company: 'Insilico Medicine', symbol: null, approach: '生成式 AI 分子设计（pan-TEAD 抑制剂）', indication: '实体瘤' },
    { drug: 'REC-617', aliases: ['REC-617', 'GTAEXS617', 'GTAEXS-617'], company: 'Recursion', symbol: 'RXRX', approach: 'AI 精准设计（原 Exscientia，CDK7 抑制剂）', indication: '晚期实体瘤' },
    { drug: 'REC-4881', aliases: ['REC-4881'], company: 'Recursion', symbol: 'RXRX', approach: '细胞表型图像 + 机器学习筛选', indication: '家族性腺瘤性息肉病' },
    { drug: 'REC-1245', aliases: ['REC-1245'], company: 'Recursion', symbol: 'RXRX', approach: '细胞表型图像 + 机器学习（RBM39 降解剂）', indication: '实体瘤 / 淋巴瘤' },
    { drug: 'REC-4539', aliases: ['REC-4539'], company: 'Recursion', symbol: 'RXRX', approach: 'AI 精准设计（LSD1 抑制剂）', indication: '小细胞肺癌' },
    { drug: 'SGR-1505', aliases: ['SGR-1505'], company: 'Schrödinger', symbol: 'SDGR', approach: '物理计算 + 机器学习（MALT1 抑制剂）', indication: 'B 细胞淋巴瘤' },
    { drug: 'SGR-3515', aliases: ['SGR-3515'], company: 'Schrödinger', symbol: 'SDGR', approach: '物理计算 + 机器学习（Wee1/Myt1 抑制剂）', indication: '实体瘤' },
    { drug: 'zasocitinib', aliases: ['zasocitinib', 'TAK-279', 'NDI-034858'], company: 'Takeda（源自 Nimbus）', symbol: 'TAK', approach: '计算化学平台设计（TYK2 抑制剂），计算驱动药物中进度最靠前之一', indication: '银屑病等自身免疫病' },
    { drug: 'RLY-2608', aliases: ['RLY-2608'], company: 'Relay Therapeutics', symbol: 'RLAY', approach: '蛋白质动态模拟 + 计算设计（突变选择性 PI3Kα）', indication: 'HR+/HER2- 乳腺癌' },
    { drug: 'ABS-201', aliases: ['ABS-201'], company: 'Absci', symbol: 'ABSI', approach: '生成式 AI 抗体设计（抗 PRLR）', indication: '雄激素性脱发' },
    { drug: 'GB-0895', aliases: ['GB-0895'], company: 'Generate Biomedicines', symbol: null, approach: '生成式 AI 蛋白/抗体设计（长效抗 TSLP）', indication: '哮喘' },
    { drug: 'IAM1363', aliases: ['IAM1363'], company: 'Iambic Therapeutics', symbol: null, approach: 'AI 分子生成 + 性质预测（HER2）', indication: 'HER2 阳性实体瘤' },
    { drug: 'aleniglipron', aliases: ['aleniglipron', 'GSBR-1290'], company: 'Structure Therapeutics', symbol: 'GPCR', approach: '结构计算平台设计的口服小分子 GLP-1', indication: '肥胖' },
    { drug: 'ABCL635', aliases: ['ABCL635'], company: 'AbCellera', symbol: 'ABCL', approach: 'AI 抗体发现平台', indication: '更年期潮热（血管舒缩症状）' },
    { drug: 'ABCL575', aliases: ['ABCL575'], company: 'AbCellera', symbol: 'ABCL', approach: 'AI 抗体发现平台（OX40L）', indication: '特应性皮炎' },
    { drug: 'ENV-294', aliases: ['ENV-294'], company: 'Enveda', symbol: null, approach: '天然产物 + 机器学习化学空间挖掘', indication: '特应性皮炎' },
];

export interface SeedConference {
    name: string;
    /** 锚点日期：month 精度时取当月 1 日 */
    startDate: string;
    precision: 'day' | 'month';
    dateText: string;
    themes: string[];
    note: string;
}

const UNVERIFIED = '日期按往年惯例估计，请以官网为准';

export const SEED_CONFERENCES: SeedConference[] = [
    { name: 'ObesityWeek', startDate: '2026-11-01', precision: 'month', dateText: '2026 年 11 月', themes: ['obesity'], note: `美国肥胖学会年会，减重药数据集中发布。${UNVERIFIED}` },
    { name: 'AASLD The Liver Meeting', startDate: '2026-11-01', precision: 'month', dateText: '2026 年 11 月', themes: ['obesity'], note: `肝病年会，MASH（脂肪肝炎）数据，与减重药相关。${UNVERIFIED}` },
    { name: 'SITC 年会', startDate: '2026-11-01', precision: 'month', dateText: '2026 年 11 月', themes: ['adc', 'gene-cell'], note: `肿瘤免疫治疗学会年会。${UNVERIFIED}` },
    { name: 'ASH 年会', startDate: '2026-12-01', precision: 'month', dateText: '2026 年 12 月上旬', themes: ['gene-cell', 'adc'], note: `美国血液学会年会，CAR-T / 基因疗法 / 血液肿瘤的关键数据窗口。${UNVERIFIED}` },
    { name: 'San Antonio 乳腺癌研讨会（SABCS）', startDate: '2026-12-01', precision: 'month', dateText: '2026 年 12 月', themes: ['adc'], note: `乳腺癌领域最重要的会议，ADC 数据常在此发布。${UNVERIFIED}` },
    { name: 'NeurIPS', startDate: '2026-12-01', precision: 'month', dateText: '2026 年 12 月', themes: ['ai-drug'], note: `AI 顶会，蛋白质/分子生成模型的新方法常在此亮相。${UNVERIFIED}` },
    { name: 'J.P. Morgan 医疗健康大会', startDate: '2027-01-01', precision: 'month', dateText: '2027 年 1 月第二周（旧金山）', themes: ['ai-drug', 'ai-dx', 'obesity', 'adc', 'gene-cell', 'china-out'], note: `一年里最重要的医药投资会议：大药企公布全年指引，大额并购和授权交易扎堆宣布。${UNVERIFIED}` },
    { name: 'ASCO GI', startDate: '2027-01-01', precision: 'month', dateText: '2027 年 1 月', themes: ['adc'], note: `消化道肿瘤会议。${UNVERIFIED}` },
    { name: 'ASCO GU', startDate: '2027-02-01', precision: 'month', dateText: '2027 年 2 月', themes: ['adc'], note: `泌尿生殖肿瘤会议。${UNVERIFIED}` },
    { name: 'AACR 年会', startDate: '2027-04-01', precision: 'month', dateText: '2027 年 4 月', themes: ['ai-drug', 'adc', 'gene-cell'], note: `美国癌症研究协会年会，早期临床和临床前数据为主。${UNVERIFIED}` },
    { name: 'ASCO 年会', startDate: '2027-06-01', precision: 'month', dateText: '2027 年 5 月底–6 月初（芝加哥）', themes: ['adc', 'gene-cell', 'china-out'], note: `全球最大的肿瘤会议，摘要提前约两周公开，常引发股价提前反应。${UNVERIFIED}` },
    { name: 'ADA 科学年会', startDate: '2027-06-01', precision: 'month', dateText: '2027 年 6 月', themes: ['obesity'], note: `美国糖尿病协会年会，GLP-1 数据的主战场。${UNVERIFIED}` },
    { name: 'EHA 年会', startDate: '2027-06-01', precision: 'month', dateText: '2027 年 6 月', themes: ['gene-cell'], note: `欧洲血液学会年会。${UNVERIFIED}` },
    { name: 'BIO 国际大会', startDate: '2027-06-01', precision: 'month', dateText: '2027 年 6 月', themes: ['china-out', 'ai-drug'], note: `生物技术产业大会，合作与授权交易洽谈集中地。${UNVERIFIED}` },
    { name: 'EASD 年会', startDate: '2027-09-01', precision: 'month', dateText: '2027 年 9 月', themes: ['obesity'], note: `欧洲糖尿病研究协会年会。${UNVERIFIED}` },
    { name: 'ESMO 年会', startDate: '2027-10-01', precision: 'month', dateText: '2027 年 9–10 月', themes: ['adc', 'china-out'], note: `欧洲肿瘤内科学会年会，重磅三期数据常在此发布。${UNVERIFIED}` },
];

/** 生物医药专业基金（13F 机构动向），CIK 已在 EDGAR 核对；ARK 等综合型基金的变动多是非医药股，不收 */
export const FRONTIER_FUNDS: Array<{ cik: string; name: string }> = [
    { cik: '1346824', name: 'RA Capital' },
    { cik: '1263508', name: 'Baker Bros.' },
    { cik: '1224962', name: 'Perceptive Advisors' },
    { cik: '1055951', name: 'OrbiMed' },
    { cik: '1009258', name: 'Deerfield' },
    { cik: '1633313', name: 'Avoro Capital' },
    { cik: '1587114', name: 'EcoR1 Capital' },
    { cik: '1493215', name: 'RTW Investments' },
    { cik: '1802528', name: 'Fairmount' },
    { cik: '1534261', name: 'Casdin Capital' },
];
