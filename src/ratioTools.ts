/**
 * Valuation API — Ratio Tool Definitions + Dispatch (Phase 1)
 *
 * Data-driven TDQS tool surface for the standard financial ratio families.
 * Each definition assembles a description that explicitly covers the six
 * Glama Tool Definition Quality dimensions: Purpose Clarity, Usage
 * Guidelines, Behavioral Transparency, Parameter Semantics, Conciseness &
 * Structure, Contextual Completeness.
 *
 * All descriptions are original text written from standard financial
 * practice — no third-party prose is reproduced or paraphrased.
 */

import * as ratios from './ratios';

// ============================================================
// Types
// ============================================================

interface RatioAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: RatioAnnotations;
}

const PURE_FN_ANNOTATIONS: RatioAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const BEHAVIOUR =
  'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; ' +
  'idempotent and non-destructive; identical inputs always produce identical outputs. ' +
  'Division by zero or non-finite inputs returns an explicit error instead of a number. ';

interface ParamDef {
  name: string;
  desc: string;
  required?: boolean;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
}

interface RatioDef {
  name: string;
  purpose: string;
  formula: string;
  whenUse: string;
  whenNot: string;
  returns: string;
  params: ParamDef[];
  /** 'pct' ratios return a decimal + a *_pct companion; 'plain' return the raw value */
  kind: 'pct' | 'plain';
  decimals?: number;
  fn: (...args: number[]) => number;
  /** map param names in schema order to the function call */
  order: string[];
}

// ============================================================
// Definitions
// ============================================================

const DEFS: RatioDef[] = [
  // ---- LIQUIDITY ----
  {
    name: 'calculate_current_ratio',
    purpose:
      'Calculate the current ratio, a liquidity measure of whether a company can cover its short-term obligations (due within a year) with its short-term assets.',
    formula: 'Current Ratio = Current Assets / Current Liabilities',
    whenUse:
      'Use to assess short-term solvency, compare liquidity across peers of different sizes, or screen for distress risk.',
    whenNot:
      'Do NOT use as the sole liquidity measure — it ignores asset quality and timing of cash flows (use calculate_quick_ratio or calculate_cash_ratio for stricter views).',
    returns: '{ current_ratio: number (e.g. 1.8 = 1.8x), inputs }.',
    params: [
      { name: 'current_assets', desc: 'Total current assets, e.g. 500000. Must be >= 0.', minimum: 0, required: true },
      { name: 'current_liabilities', desc: 'Total current liabilities, e.g. 280000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.currentRatio,
    order: ['current_assets', 'current_liabilities'],
  },
  {
    name: 'calculate_quick_ratio',
    purpose:
      'Calculate the quick (acid-test) ratio: liquid assets excluding inventory divided by current liabilities — a stricter short-term solvency test than the current ratio.',
    formula: 'Quick Ratio = (Current Assets - Inventory) / Current Liabilities',
    whenUse:
      'Use when inventory is slow-moving or hard to liquidate and you want a conservative view of short-term payment ability.',
    whenNot:
      'Do NOT use for businesses where inventory converts to cash quickly (e.g. retailers with fast sell-through) — it understates true liquidity.',
    returns: '{ quick_ratio: number (e.g. 1.2 = 1.2x), inputs }.',
    params: [
      { name: 'current_assets', desc: 'Total current assets, e.g. 500000. Must be >= 0.', minimum: 0, required: true },
      { name: 'inventory', desc: 'Inventory value to exclude, e.g. 120000. Must be >= 0 and <= current_assets.', minimum: 0, required: true },
      { name: 'current_liabilities', desc: 'Total current liabilities, e.g. 280000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.quickRatio,
    order: ['current_assets', 'inventory', 'current_liabilities'],
  },
  {
    name: 'calculate_cash_ratio',
    purpose:
      'Calculate the cash ratio: cash and marketable securities divided by current liabilities — the most conservative liquidity measure.',
    formula: 'Cash Ratio = (Cash + Marketable Securities) / Current Liabilities',
    whenUse:
      'Use for the strictest view of liquidity, or when a company is in distress and only cash-like assets can be relied on.',
    whenNot:
      'Do NOT use in isolation for healthy operating businesses — it ignores receivables and inventory that normally convert to cash.',
    returns: '{ cash_ratio: number (e.g. 0.5 = 0.5x), inputs }.',
    params: [
      { name: 'cash_and_equivalents', desc: 'Cash and cash equivalents, e.g. 80000. Must be >= 0.', minimum: 0, required: true },
      { name: 'marketable_securities', desc: 'Short-term marketable securities, e.g. 30000. Must be >= 0.', minimum: 0, required: true },
      { name: 'current_liabilities', desc: 'Total current liabilities, e.g. 220000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.cashRatio,
    order: ['cash_and_equivalents', 'marketable_securities', 'current_liabilities'],
  },
  {
    name: 'calculate_defensive_interval',
    purpose:
      'Calculate the defensive interval ratio: how many days a company can fund its operating expenses from liquid assets alone, without new revenue.',
    formula: 'Defensive Interval = (Cash + Marketable Securities + Receivables) / Daily Operating Expenses',
    whenUse:
      'Use to gauge cash runway from liquid assets — useful for startups, distressed companies, or businesses with lumpy revenue.',
    whenNot:
      'Do NOT use for companies with stable, predictable revenue where ongoing collections are dependable.',
    returns: '{ defensive_interval_days: number (e.g. 45.3 days), inputs }.',
    params: [
      { name: 'cash_and_equivalents', desc: 'Cash and cash equivalents, e.g. 80000. Must be >= 0.', minimum: 0, required: true },
      { name: 'marketable_securities', desc: 'Short-term marketable securities, e.g. 30000. Must be >= 0.', minimum: 0, required: true },
      { name: 'receivables', desc: 'Accounts receivable, e.g. 60000. Must be >= 0.', minimum: 0, required: true },
      { name: 'daily_operating_expenses', desc: 'Daily operating expenses (annual opex / 365), e.g. 3750. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 1,
    fn: ratios.defensiveInterval,
    order: ['cash_and_equivalents', 'marketable_securities', 'receivables', 'daily_operating_expenses'],
  },

  // ---- LEVERAGE ----
  {
    name: 'calculate_debt_to_equity',
    purpose:
      'Calculate the debt-to-equity ratio: total debt divided by shareholders\u2019 equity — how much a company relies on debt versus equity financing.',
    formula: 'Debt-to-Equity = Total Debt / Shareholders\u2019 Equity',
    whenUse:
      'Use to evaluate capital structure and financial risk, compare leverage across peers, or assess covenant headroom.',
    whenNot:
      'Do NOT compare D/E across industries without context — capital intensity varies widely; a negative ratio (negative equity) indicates distress, not low leverage.',
    returns: '{ debt_to_equity: number (e.g. 1.5 = 1.5x), inputs }.',
    params: [
      { name: 'total_debt', desc: 'Total debt (short-term + long-term interest-bearing), e.g. 300000. Must be >= 0.', minimum: 0, required: true },
      { name: 'shareholders_equity', desc: 'Total shareholders\u2019 equity, e.g. 200000. May be negative in distress (result will be negative).', required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.debtToEquity,
    order: ['total_debt', 'shareholders_equity'],
  },
  {
    name: 'calculate_debt_to_assets',
    purpose:
      'Calculate the debt-to-assets ratio: total debt divided by total assets — the proportion of a company\u2019s assets financed by debt.',
    formula: 'Debt-to-Assets = Total Debt / Total Assets',
    whenUse:
      'Use to measure overall leverage and asset encumbrance; values above 0.5 indicate debt funds more than half of assets.',
    whenNot:
      'Do NOT use when you need the debt-to-equity view of capital structure (use calculate_debt_to_equity).',
    returns: '{ debt_to_assets: decimal (e.g. 0.42 = 42%), debt_to_assets_pct: number (e.g. 42.0), inputs }.',
    params: [
      { name: 'total_debt', desc: 'Total debt, e.g. 300000. Must be >= 0.', minimum: 0, required: true },
      { name: 'total_assets', desc: 'Total assets, e.g. 720000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.debtToAssets,
    order: ['total_debt', 'total_assets'],
  },
  {
    name: 'calculate_equity_multiplier',
    purpose:
      'Calculate the equity multiplier: total assets divided by shareholders\u2019 equity — a leverage measure of how many units of assets each unit of equity supports.',
    formula: 'Equity Multiplier = Total Assets / Shareholders\u2019 Equity',
    whenUse:
      'Use in DuPont analysis (ROE = Net Margin x Asset Turnover x Equity Multiplier) or to quantify financial leverage.',
    whenNot:
      'Do NOT use alone — a high multiplier can mean efficient leverage or distress depending on profitability (pair with ROE/ROA).',
    returns: '{ equity_multiplier: number (e.g. 3.6 = 3.6x), inputs }.',
    params: [
      { name: 'total_assets', desc: 'Total assets, e.g. 720000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'shareholders_equity', desc: 'Total shareholders\u2019 equity, e.g. 200000. May be negative in distress.', required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.equityMultiplier,
    order: ['total_assets', 'shareholders_equity'],
  },
  {
    name: 'calculate_interest_coverage',
    purpose:
      'Calculate the interest coverage ratio: earnings before interest and taxes divided by interest expense — how many times a company can cover its interest obligations from operating earnings.',
    formula: 'Interest Coverage = EBIT / Interest Expense',
    whenUse:
      'Use to assess credit risk and debt-service capacity; below 1.5 is typically a distress signal, above 3 is comfortable for most industries.',
    whenNot:
      'Do NOT use for companies with significant non-cash EBIT distortions (large depreciation) — consider EBITDA-based coverage for those.',
    returns: '{ interest_coverage: number (e.g. 4.2 = 4.2x), inputs }.',
    params: [
      { name: 'ebit', desc: 'Earnings before interest and taxes (operating income), e.g. 420000. May be negative.', required: true },
      { name: 'interest_expense', desc: 'Annual interest expense, e.g. 100000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.interestCoverage,
    order: ['ebit', 'interest_expense'],
  },

  // ---- EFFICIENCY ----
  {
    name: 'calculate_asset_turnover',
    purpose:
      'Calculate asset turnover: net sales divided by average total assets — how efficiently a company generates revenue from its asset base.',
    formula: 'Asset Turnover = Net Sales / Average Total Assets',
    whenUse:
      'Use to compare revenue productivity across companies or years; a falling ratio suggests assets are not generating sales efficiently.',
    whenNot:
      'Do NOT compare asset turnover across industries — capital intensity differs fundamentally (software vs manufacturing).',
    returns: '{ asset_turnover: number (e.g. 0.85 = 0.85x per year), inputs }.',
    params: [
      { name: 'net_sales', desc: 'Net sales / revenue for the period, e.g. 900000. Must be >= 0.', minimum: 0, required: true },
      { name: 'begin_total_assets', desc: 'Total assets at the START of the period, e.g. 1000000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_total_assets', desc: 'Total assets at the END of the period, e.g. 1100000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.assetTurnover,
    order: ['net_sales', 'begin_total_assets', 'end_total_assets'],
  },
  {
    name: 'calculate_fixed_asset_turnover',
    purpose:
      'Calculate fixed asset turnover: net sales divided by average net fixed assets — how efficiently a company uses its plant, property and equipment to generate sales.',
    formula: 'Fixed Asset Turnover = Net Sales / Average Net Fixed Assets',
    whenUse:
      'Use for capital-intensive businesses to gauge whether fixed assets are earning their keep (e.g. manufacturing, logistics).',
    whenNot:
      'Do NOT use for asset-light businesses (software, services) where the ratio is misleadingly high and uninformative.',
    returns: '{ fixed_asset_turnover: number (e.g. 2.1 = 2.1x per year), inputs }.',
    params: [
      { name: 'net_sales', desc: 'Net sales / revenue for the period, e.g. 900000. Must be >= 0.', minimum: 0, required: true },
      { name: 'begin_net_fixed_assets', desc: 'Net fixed assets (PP&E after depreciation) at period start, e.g. 400000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_net_fixed_assets', desc: 'Net fixed assets at period end, e.g. 450000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.fixedAssetTurnover,
    order: ['net_sales', 'begin_net_fixed_assets', 'end_net_fixed_assets'],
  },
  {
    name: 'calculate_inventory_turnover',
    purpose:
      'Calculate inventory turnover: cost of goods sold divided by average inventory — how many times inventory is sold and replaced in a period.',
    formula: 'Inventory Turnover = COGS / Average Inventory',
    whenUse:
      'Use to assess inventory management and demand strength; rising turnover usually means better stock discipline or strong demand.',
    whenNot:
      'Do NOT use COGS-based turnover for service businesses with negligible inventory, and always pair with days inventory outstanding for intuition.',
    returns: '{ inventory_turnover: number (e.g. 6.0 = 6.0x per year), inputs }.',
    params: [
      { name: 'cogs', desc: 'Cost of goods sold for the period, e.g. 600000. Must be >= 0.', minimum: 0, required: true },
      { name: 'begin_inventory', desc: 'Inventory at period start, e.g. 90000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_inventory', desc: 'Inventory at period end, e.g. 110000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.inventoryTurnover,
    order: ['cogs', 'begin_inventory', 'end_inventory'],
  },
  {
    name: 'calculate_receivables_turnover',
    purpose:
      'Calculate receivables turnover: net credit sales divided by average accounts receivable — how efficiently a company collects money owed by customers.',
    formula: 'Receivables Turnover = Net Credit Sales / Average Accounts Receivable',
    whenUse:
      'Use to assess collection efficiency and customer credit quality; a falling ratio signals slower collections or looser credit terms.',
    whenNot:
      'Do NOT use total revenue if a large share of sales is cash (use credit sales only), and pair with days sales outstanding for intuition.',
    returns: '{ receivables_turnover: number (e.g. 8.0 = 8.0x per year), inputs }.',
    params: [
      { name: 'net_credit_sales', desc: 'Net credit sales for the period, e.g. 800000. Must be >= 0.', minimum: 0, required: true },
      { name: 'begin_receivables', desc: 'Accounts receivable at period start, e.g. 95000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_receivables', desc: 'Accounts receivable at period end, e.g. 105000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.receivablesTurnover,
    order: ['net_credit_sales', 'begin_receivables', 'end_receivables'],
  },
  {
    name: 'calculate_payables_turnover',
    purpose:
      'Calculate payables turnover: purchases (or COGS) divided by average accounts payable — how many times a company pays its suppliers in a period.',
    formula: 'Payables Turnover = COGS or Purchases / Average Accounts Payable',
    whenUse:
      'Use to assess supplier payment speed and working-capital management; lower turnover means the company stretches supplier credit longer.',
    whenNot:
      'Do NOT interpret low payables turnover as inefficiency without context — it can be a deliberate financing strategy.',
    returns: '{ payables_turnover: number (e.g. 7.5 = 7.5x per year), inputs }.',
    params: [
      { name: 'cogs_or_purchases', desc: 'Cost of goods sold or total purchases for the period, e.g. 600000. Must be >= 0.', minimum: 0, required: true },
      { name: 'begin_payables', desc: 'Accounts payable at period start, e.g. 70000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_payables', desc: 'Accounts payable at period end, e.g. 90000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.payablesTurnover,
    order: ['cogs_or_purchases', 'begin_payables', 'end_payables'],
  },
  {
    name: 'calculate_days_sales_outstanding',
    purpose:
      'Calculate days sales outstanding (DSO): the average number of days it takes a company to collect payment after a sale.',
    formula: 'DSO = 365 / Receivables Turnover',
    whenUse:
      'Use to measure collection speed and working-capital drag; rising DSO ties up cash and may signal collection problems.',
    whenNot:
      'Do NOT use when credit sales are unknown (mixed cash/credit revenue distorts the result).',
    returns: '{ days_sales_outstanding: number of days (e.g. 45.6), inputs }.',
    params: [
      { name: 'net_credit_sales', desc: 'Net credit sales for the period, e.g. 800000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'begin_receivables', desc: 'Accounts receivable at period start, e.g. 95000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_receivables', desc: 'Accounts receivable at period end, e.g. 105000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 1,
    fn: ratios.daysSalesOutstanding,
    order: ['net_credit_sales', 'begin_receivables', 'end_receivables'],
  },
  {
    name: 'calculate_days_inventory_outstanding',
    purpose:
      'Calculate days inventory outstanding (DIO): the average number of days a company holds inventory before selling it.',
    formula: 'DIO = 365 / Inventory Turnover',
    whenUse:
      'Use to assess inventory efficiency and capital tied up in stock; high DIO risks obsolescence and cash drag.',
    whenNot:
      'Do NOT apply mechanically across industries — optimal DIO differs hugely between fresh grocery and heavy machinery.',
    returns: '{ days_inventory_outstanding: number of days (e.g. 60.8), inputs }.',
    params: [
      { name: 'cogs', desc: 'Cost of goods sold for the period, e.g. 600000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'begin_inventory', desc: 'Inventory at period start, e.g. 90000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_inventory', desc: 'Inventory at period end, e.g. 110000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 1,
    fn: ratios.daysInventoryOutstanding,
    order: ['cogs', 'begin_inventory', 'end_inventory'],
  },
  {
    name: 'calculate_days_payables_outstanding',
    purpose:
      'Calculate days payables outstanding (DPO): the average number of days a company takes to pay its suppliers.',
    formula: 'DPO = 365 / Payables Turnover',
    whenUse:
      'Use to measure how long a company holds onto cash before paying suppliers — a source of working-capital financing.',
    whenNot:
      'Do NOT treat very high DPO as always positive — it can indicate cash stress or strained supplier relationships.',
    returns: '{ days_payables_outstanding: number of days (e.g. 48.7), inputs }.',
    params: [
      { name: 'cogs_or_purchases', desc: 'Cost of goods sold or purchases for the period, e.g. 600000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'begin_payables', desc: 'Accounts payable at period start, e.g. 70000. Must be >= 0.', minimum: 0, required: true },
      { name: 'end_payables', desc: 'Accounts payable at period end, e.g. 90000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 1,
    fn: ratios.daysPayablesOutstanding,
    order: ['cogs_or_purchases', 'begin_payables', 'end_payables'],
  },
  {
    name: 'calculate_cash_conversion_cycle',
    purpose:
      'Calculate the cash conversion cycle (CCC): DSO + DIO - DPO — the net number of days cash is tied up between paying suppliers and collecting from customers.',
    formula: 'CCC = Days Sales Outstanding + Days Inventory Outstanding - Days Payables Outstanding',
    whenUse:
      'Use as the definitive working-capital efficiency measure: a shorter (or negative) CCC means less capital trapped in operations.',
    whenNot:
      'Do NOT use unless all three components are computed on a consistent 365-day basis and comparable periods.',
    returns: '{ cash_conversion_cycle_days: number (e.g. 57.7 days; negative = operating on supplier cash), inputs }.',
    params: [
      { name: 'dso', desc: 'Days sales outstanding, e.g. 45.6.', required: true },
      { name: 'dio', desc: 'Days inventory outstanding, e.g. 60.8.', required: true },
      { name: 'dpo', desc: 'Days payables outstanding, e.g. 48.7.', required: true },
    ],
    kind: 'plain',
    decimals: 1,
    fn: ratios.cashConversionCycle,
    order: ['dso', 'dio', 'dpo'],
  },

  // ---- PROFITABILITY ----
  {
    name: 'calculate_gross_margin',
    purpose:
      'Calculate gross margin: gross profit divided by net sales — the share of revenue retained after the direct cost of goods sold.',
    formula: 'Gross Margin = Gross Profit / Net Sales',
    whenUse:
      'Use to assess product-level economics and pricing power before operating expenses are considered.',
    whenNot:
      'Do NOT use gross margin to compare companies with different cost classification practices (COGS boundary varies).',
    returns: '{ gross_margin: decimal (e.g. 0.40 = 40%), gross_margin_pct: number (e.g. 40.0), inputs }.',
    params: [
      { name: 'gross_profit', desc: 'Gross profit = net sales - COGS, e.g. 400000. Must be >= 0.', minimum: 0, required: true },
      { name: 'net_sales', desc: 'Net sales / revenue, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.grossMargin,
    order: ['gross_profit', 'net_sales'],
  },
  {
    name: 'calculate_operating_margin',
    purpose:
      'Calculate operating margin: operating income divided by net sales — profitability from core operations before financing and tax.',
    formula: 'Operating Margin = Operating Income / Net Sales',
    whenUse:
      'Use to compare core business profitability across peers and over time, independent of capital structure.',
    whenNot:
      'Do NOT use when one-off items distort operating income — consider normalised EBIT instead.',
    returns: '{ operating_margin: decimal (e.g. 0.18 = 18%), operating_margin_pct: number (e.g. 18.0), inputs }.',
    params: [
      { name: 'operating_income', desc: 'Operating income / EBIT, e.g. 180000. May be negative.', required: true },
      { name: 'net_sales', desc: 'Net sales / revenue, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.operatingMargin,
    order: ['operating_income', 'net_sales'],
  },
  {
    name: 'calculate_net_margin',
    purpose:
      'Calculate net margin: net income divided by net sales — the share of every revenue pound/dollar that reaches the bottom line.',
    formula: 'Net Margin = Net Income / Net Sales',
    whenUse:
      'Use for the all-in profitability picture after operating costs, interest, tax and other items.',
    whenNot:
      'Do NOT use alone — net margin is affected by capital structure and tax; compare alongside gross and operating margins.',
    returns: '{ net_margin: decimal (e.g. 0.12 = 12%), net_margin_pct: number (e.g. 12.0), inputs }.',
    params: [
      { name: 'net_income', desc: 'Net income after tax, e.g. 120000. May be negative.', required: true },
      { name: 'net_sales', desc: 'Net sales / revenue, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.netMargin,
    order: ['net_income', 'net_sales'],
  },
  {
    name: 'calculate_return_on_assets',
    purpose:
      'Calculate return on assets (ROA): net income divided by average total assets — how efficiently a company converts its asset base into profit.',
    formula: 'ROA = Net Income / Average Total Assets',
    whenUse:
      'Use to measure management\u2019s efficiency in deploying all assets, independent of how they are financed.',
    whenNot:
      'Do NOT compare ROA across industries with different asset intensity; use ROIC for a cleaner operating view.',
    returns: '{ return_on_assets: decimal (e.g. 0.08 = 8%), return_on_assets_pct: number (e.g. 8.0), inputs }.',
    params: [
      { name: 'net_income', desc: 'Net income after tax, e.g. 84000. May be negative.', required: true },
      { name: 'begin_total_assets', desc: 'Total assets at period start, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'end_total_assets', desc: 'Total assets at period end, e.g. 1100000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.roa,
    order: ['net_income', 'begin_total_assets', 'end_total_assets'],
  },
  {
    name: 'calculate_return_on_equity',
    purpose:
      'Calculate return on equity (ROE): net income divided by average shareholders\u2019 equity — the return earned on the owners\u2019 invested capital.',
    formula: 'ROE = Net Income / Average Shareholders\u2019 Equity',
    whenUse:
      'Use to assess how well management generates returns for shareholders; decompose via DuPont (margin x turnover x leverage) for drivers.',
    whenNot:
      'Do NOT use when equity is small or negative (distress / heavy buybacks) — ROE explodes or inverts and misleads.',
    returns: '{ return_on_equity: decimal (e.g. 0.15 = 15%), return_on_equity_pct: number (e.g. 15.0), inputs }.',
    params: [
      { name: 'net_income', desc: 'Net income after tax, e.g. 150000. May be negative.', required: true },
      { name: 'begin_equity', desc: 'Shareholders\u2019 equity at period start, e.g. 950000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'end_equity', desc: 'Shareholders\u2019 equity at period end, e.g. 1050000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.roe,
    order: ['net_income', 'begin_equity', 'end_equity'],
  },
  {
    name: 'calculate_return_on_capital_employed',
    purpose:
      'Calculate return on capital employed (ROCE): EBIT divided by capital employed (total assets minus current liabilities) — return generated by the capital actually deployed in the business.',
    formula: 'ROCE = EBIT / (Total Assets - Current Liabilities)',
    whenUse:
      'Use to compare profitability across companies with different capital structures — EBIT (pre-financing) over all capital employed.',
    whenNot:
      'Do NOT use when capital employed is near zero or negative; prefer ROIC for after-tax operating returns.',
    returns: '{ return_on_capital_employed: decimal (e.g. 0.22 = 22%), return_on_capital_employed_pct: number (e.g. 22.0), inputs }.',
    params: [
      { name: 'ebit', desc: 'Earnings before interest and taxes, e.g. 220000. May be negative.', required: true },
      { name: 'total_assets', desc: 'Total assets, e.g. 1200000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'current_liabilities', desc: 'Total current liabilities, e.g. 200000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.roce,
    order: ['ebit', 'total_assets', 'current_liabilities'],
  },
  {
    name: 'calculate_return_on_invested_capital',
    purpose:
      'Calculate return on invested capital (ROIC): NOPAT divided by invested capital — the after-tax operating return on capital invested in the business.',
    formula: 'ROIC = NOPAT / Invested Capital',
    whenUse:
      'Use to assess value creation: ROIC above the cost of capital (WACC) creates value; below it destroys value. Core metric for investors.',
    whenNot:
      'Do NOT use if you lack a clean NOPAT or invested capital figure — inconsistent definitions make ROIC incomparable.',
    returns: '{ return_on_invested_capital: decimal (e.g. 0.18 = 18%), return_on_invested_capital_pct: number (e.g. 18.0), inputs }.',
    params: [
      { name: 'nopat', desc: 'Net operating profit after tax = EBIT x (1 - tax rate), e.g. 180000. May be negative.', required: true },
      { name: 'invested_capital', desc: 'Invested capital (equity + debt - cash, or operating assets - operating liabilities), e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.roic,
    order: ['nopat', 'invested_capital'],
  },

  // ---- MARKET VALUE ----
  {
    name: 'calculate_eps',
    purpose:
      'Calculate earnings per share (EPS): net income divided by weighted average shares outstanding — profit attributable to each share.',
    formula: 'EPS = Net Income / Weighted Average Shares Outstanding',
    whenUse:
      'Use as the denominator for P/E and payout ratios and to track per-share profitability over time.',
    whenNot:
      'Do NOT use basic share count when convertible securities exist — use diluted shares for a conservative EPS.',
    returns: '{ eps: number (currency per share, e.g. 1.25), inputs }.',
    params: [
      { name: 'net_income', desc: 'Net income attributable to common shareholders, e.g. 1250000. May be negative.', required: true },
      { name: 'weighted_avg_shares_outstanding', desc: 'Weighted average shares outstanding during the period, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.eps,
    order: ['net_income', 'weighted_avg_shares_outstanding'],
  },
  {
    name: 'calculate_pe_ratio',
    purpose:
      'Calculate the price-to-earnings (P/E) ratio: share price divided by earnings per share — how much investors pay per unit of earnings.',
    formula: 'P/E = Share Price / EPS',
    whenUse:
      'Use for relative valuation against peers, sector averages, or a company\u2019s own history. Higher P/E = market expects higher growth.',
    whenNot:
      'Do NOT use when EPS is negative or near zero (ratio becomes meaningless), and prefer forward P/E for growth companies.',
    returns: '{ pe_ratio: number (e.g. 18.5 = 18.5x), inputs }.',
    params: [
      { name: 'share_price', desc: 'Current share price in currency units, e.g. 45.00. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'earnings_per_share', desc: 'Earnings per share (trailing or forward), e.g. 2.43. Must be > 0 for a meaningful ratio.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.peRatio,
    order: ['share_price', 'earnings_per_share'],
  },
  {
    name: 'calculate_pb_ratio',
    purpose:
      'Calculate the price-to-book (P/B) ratio: share price divided by book value per share — how much investors pay relative to accounting net asset value.',
    formula: 'P/B = Share Price / Book Value Per Share',
    whenUse:
      'Use for valuing asset-heavy or financial companies where book value is a meaningful anchor; P/B < 1 can indicate undervaluation or low returns on assets.',
    whenNot:
      'Do NOT use for asset-light businesses (intangibles make book value meaningless) or where book value is negative.',
    returns: '{ pb_ratio: number (e.g. 1.4 = 1.4x), inputs }.',
    params: [
      { name: 'share_price', desc: 'Current share price, e.g. 45.00. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'book_value_per_share', desc: 'Book value per share (shareholders\u2019 equity / shares), e.g. 32.00. Must be > 0 for a meaningful ratio.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: ratios.pbRatio,
    order: ['share_price', 'book_value_per_share'],
  },
  {
    name: 'calculate_dividend_yield',
    purpose:
      'Calculate dividend yield: annual dividends per share divided by share price — the cash return a shareholder receives from dividends.',
    formula: 'Dividend Yield = Annual Dividends Per Share / Share Price',
    whenUse:
      'Use to compare income return against bond yields or peer dividend policies; a yield far above peers can signal a depressed price or unsustainable payout.',
    whenNot:
      'Do NOT annualise a one-off special dividend as if it were regular income.',
    returns: '{ dividend_yield: decimal (e.g. 0.035 = 3.5%), dividend_yield_pct: number (e.g. 3.5), inputs }.',
    params: [
      { name: 'annual_dividends_per_share', desc: 'Annual dividends per share, e.g. 1.58. Must be >= 0.', minimum: 0, required: true },
      { name: 'share_price', desc: 'Current share price, e.g. 45.00. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.dividendYield,
    order: ['annual_dividends_per_share', 'share_price'],
  },
  {
    name: 'calculate_payout_ratio',
    purpose:
      'Calculate the payout ratio: dividends per share divided by earnings per share — the share of profits distributed as dividends.',
    formula: 'Payout Ratio = Dividends Per Share / EPS',
    whenUse:
      'Use to judge dividend sustainability: payout above 100% means dividends exceed earnings (funded by debt or reserves).',
    whenNot:
      'Do NOT use when EPS is negative (ratio is meaningless), and note young growth companies legitimately pay little or nothing.',
    returns: '{ payout_ratio: decimal (e.g. 0.55 = 55%), payout_ratio_pct: number (e.g. 55.0), inputs }.',
    params: [
      { name: 'dividends_per_share', desc: 'Dividends per share in the period, e.g. 1.34. Must be >= 0.', minimum: 0, required: true },
      { name: 'earnings_per_share', desc: 'Earnings per share, e.g. 2.43. Must be > 0 for a meaningful ratio.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: ratios.payoutRatio,
    order: ['dividends_per_share', 'earnings_per_share'],
  },
];

// ============================================================
// Build ToolDefs (assembled descriptions) + dispatch
// ============================================================

function buildDescription(def: RatioDef): string {
  const purpose = def.purpose.replace(/\s+/g, ' ').trim();
  const paramsText = def.params
    .map((p) => `${p.name} (${p.required ? 'required' : 'optional'}): ${p.desc}`)
    .join(' ');
  return (
    `${purpose} Formula: ${def.formula}. ` +
    `WHEN TO USE: ${def.whenUse} ` +
    `WHEN NOT TO USE: ${def.whenNot} ` +
    BEHAVIOUR +
    `RETURNS: JSON object ${def.returns} ` +
    `PARAMETERS: ${paramsText}`
  );
}

function buildSchema(def: RatioDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of def.params) {
    const prop: Record<string, unknown> = { type: 'number', description: p.desc };
    if (p.minimum !== undefined) prop.minimum = p.minimum;
    if (p.exclusiveMinimum !== undefined) prop.exclusiveMinimum = p.exclusiveMinimum;
    if (p.maximum !== undefined) prop.maximum = p.maximum;
    properties[p.name] = prop;
  }
  return {
    type: 'object',
    properties,
    required: def.params.filter((p) => p.required).map((p) => p.name),
  };
}

function round(value: number, decimals: number): number {
  if (!isFinite(value)) return NaN;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

export const RATIO_TOOLS: ToolDef[] = DEFS.map((def) => ({
  name: def.name,
  description: buildDescription(def),
  inputSchema: buildSchema(def),
  annotations: PURE_FN_ANNOTATIONS,
}));

const BY_NAME = new Map(DEFS.map((d) => [d.name, d]));

export function isRatioTool(name: string): boolean {
  return BY_NAME.has(name);
}

/**
 * Run a ratio tool. Returns:
 *  - { ok: true, value } on success
 *  - { ok: false, error } on invalid inputs / division by zero
 *  - undefined if `name` is not a ratio tool
 */
export function runRatioTool(
  name: string,
  args: Record<string, unknown>
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } | undefined {
  const def = BY_NAME.get(name);
  if (!def) return undefined;

  const values: number[] = [];
  for (const paramName of def.order) {
    const v = args[paramName];
    if (typeof v !== 'number' || !isFinite(v)) {
      return { ok: false, error: `${name} requires numeric ${paramName}` };
    }
    values.push(v);
  }

  const raw = def.fn(...values);
  if (!isFinite(raw)) {
    return {
      ok: false,
      error: `${name}: result is undefined — check inputs (division by zero or invalid combination, e.g. zero denominator or zero equity in a leverage ratio)`,
    };
  }

  const rounded = round(raw, def.decimals ?? 2);
  const result: Record<string, unknown> = { inputs: { ...args } };
  if (def.kind === 'pct') {
    result[def.name.replace(/^calculate_/, '')] = rounded;
    result[`${def.name.replace(/^calculate_/, '')}_pct`] = round(raw * 100, 2);
  } else {
    result[def.name.replace(/^calculate_/, '')] = rounded;
  }
  return { ok: true, value: result };
}
