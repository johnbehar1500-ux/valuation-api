/**
 * Valuation API — Advanced Tool Definitions + Dispatch (Phase 2)
 *
 * TVM, fund-return metrics, payback analysis, enterprise value & multiples,
 * CAPM and beta (Hamada). Same data-driven TDQS assembler as ratioTools.ts,
 * extended with array-typed parameters for cash-flow tools.
 *
 * All descriptions are original text written from standard financial
 * practice — no third-party prose is reproduced or paraphrased.
 */

import * as adv from './advanced';

interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

const PURE_FN_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const BEHAVIOUR =
  'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; ' +
  'idempotent and non-destructive; identical inputs always produce identical outputs. ' +
  'Division by zero, non-finite inputs, or mathematically undefined combinations return an explicit error instead of a number. ';

interface ParamDef {
  name: string;
  desc: string;
  required?: boolean;
  type?: 'number' | 'array';
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  minItems?: number;
}

interface AdvDef {
  name: string;
  purpose: string;
  formula: string;
  whenUse: string;
  whenNot: string;
  returns: string;
  params: ParamDef[];
  kind: 'pct' | 'plain';
  decimals?: number;
  fn: (...args: any[]) => number;
  order: string[];
  behaviourNote?: string;
}

// ============================================================
// Definitions
// ============================================================

const DEFS: AdvDef[] = [
  // ---- TIME VALUE OF MONEY ----
  {
    name: 'calculate_future_value',
    purpose:
      'Calculate the future value of a single lump sum: what a present amount grows to at a given rate over a given number of periods, with compounding.',
    formula: 'FV = PV x (1 + r)^n',
    whenUse:
      'Use to project what an investment or cash balance will be worth at a future date under compound growth (e.g. an invested lump sum, or a liability growing at a stated rate).',
    whenNot:
      'Do NOT use for series of multiple cash flows (use calculate_npv or an annuity tool), or when you need the required starting amount (use calculate_present_value).',
    returns: '{ future_value: number (currency), inputs }.',
    params: [
      { name: 'present_value', desc: 'Starting amount in currency units, e.g. 100000. May be negative for a liability.', required: true },
      { name: 'rate', desc: 'Periodic rate as a decimal, e.g. 0.08 = 8% per period (never pass percentage points). Rate and periods must share frequency (annual/annual or monthly/monthly).', required: true },
      { name: 'periods', desc: 'Number of compounding periods, e.g. 5. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.futureValue,
    order: ['present_value', 'rate', 'periods'],
  },
  {
    name: 'calculate_present_value',
    purpose:
      'Calculate the present value of a single future amount: what a future lump sum is worth today discounted at a given rate over a given number of periods.',
    formula: 'PV = FV / (1 + r)^n',
    whenUse:
      'Use to discount a single known future cash flow back to today (e.g. a future exit value, a balloon payment, or a single future receipt).',
    whenNot:
      'Do NOT use for multiple cash-flow streams (use calculate_npv) or for perpetual/annuity streams (use the perpetuity or annuity tools).',
    returns: '{ present_value: number (currency), inputs }.',
    params: [
      { name: 'future_value', desc: 'Future amount in currency units, e.g. 250000. May be negative for a future payment.', required: true },
      { name: 'rate', desc: 'Discount rate as a decimal, e.g. 0.10 = 10% per period (never pass percentage points). Rate and periods must share frequency.', required: true },
      { name: 'periods', desc: 'Number of discounting periods, e.g. 5. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.presentValue,
    order: ['future_value', 'rate', 'periods'],
  },
  {
    name: 'calculate_cagr',
    purpose:
      'Calculate the Compound Annual Growth Rate (CAGR): the smoothed annual growth rate that takes a beginning value to an ending value over a given number of years.',
    formula: 'CAGR = (End Value / Begin Value)^(1/n) - 1',
    whenUse:
      'Use to state multi-year growth as a single comparable annualised rate (revenue growth, asset growth, fund performance) — the standard "growth per year" figure.',
    whenNot:
      'Do NOT use when the beginning value is zero or negative (undefined), or when you need period-by-period volatility rather than a smoothed rate.',
    returns: '{ cagr: decimal (e.g. 0.201 = 20.1%), cagr_pct: number (e.g. 20.1), inputs }.',
    params: [
      { name: 'begin_value', desc: 'Value at the START of the period, e.g. 100000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'end_value', desc: 'Value at the END of the period, e.g. 250000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'periods', desc: 'Number of years between the two values, e.g. 5. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: adv.cagr,
    order: ['begin_value', 'end_value', 'periods'],
  },
  {
    name: 'calculate_annuity_present_value',
    purpose:
      'Calculate the present value of an ordinary annuity: a series of equal payments received (or paid) at the END of each period, discounted at a given rate.',
    formula: 'Annuity PV = PMT x (1 - (1 + r)^-n) / r',
    whenUse:
      'Use to value a fixed stream of level payments (e.g. lease income, lottery-style payouts, bond coupons held to maturity, or a stream of loan repayments received).',
    whenNot:
      'Do NOT use for payments at the START of each period (annuity due — adjust by multiplying by (1 + r)), for growing payments (growing annuity), or for perpetual streams (use calculate_perpetuity_value).',
    returns: '{ annuity_present_value: number (currency), inputs }.',
    params: [
      { name: 'payment', desc: 'Payment amount per period, e.g. 50000. Must be > 0 for a normal inflow annuity.', exclusiveMinimum: 0, required: true },
      { name: 'rate', desc: 'Periodic discount rate as a decimal, e.g. 0.06 = 6% (never pass percentage points). Use rate = 0 for an undiscounted sum.', required: true },
      { name: 'periods', desc: 'Number of payments/periods, e.g. 10. Must be >= 1.', minimum: 1, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.annuityPresentValue,
    order: ['payment', 'rate', 'periods'],
  },
  {
    name: 'calculate_perpetuity_value',
    purpose:
      'Calculate the present value of a perpetuity: a constant (or constant-growth) cash flow received forever, discounted at a required rate.',
    formula: 'Perpetuity PV = CF / r;  Growing perpetuity PV = CF / (r - g)',
    whenUse:
      'Use to value perpetual streams such as preferred dividends, ground rents, endowment-style income, or the terminal value component of a DCF (Gordon Growth Model).',
    whenNot:
      'Do NOT use for finite cash-flow streams (use calculate_annuity_present_value or calculate_npv), and do NOT set growth_rate >= rate — the formula is undefined there (it implies an infinite value).',
    returns: '{ perpetuity_value: number (currency), inputs }.',
    params: [
      { name: 'cash_flow', desc: 'Periodic cash flow received forever, e.g. 30000. Must be > 0 for a normal perpetuity.', exclusiveMinimum: 0, required: true },
      { name: 'rate', desc: 'Required return / discount rate as a decimal, e.g. 0.08 = 8% (never pass percentage points). Must be strictly greater than growth_rate.', required: true },
      { name: 'growth_rate', desc: 'OPTIONAL perpetual growth rate of the cash flow as a decimal, e.g. 0.03 = 3% (never pass percentage points). Defaults to 0 (no growth). Must be strictly less than rate.', required: false },
    ],
    kind: 'plain',
    decimals: 2,
    fn: (cf, rate, growth) => adv.perpetuityValue(cf as number, rate as number, (growth as number) ?? 0),
    order: ['cash_flow', 'rate', 'growth_rate'],
  },
  {
    name: 'calculate_loan_payment',
    purpose:
      'Calculate the level periodic payment (PMT) that fully amortises a loan: the constant payment per period covering principal and interest over the loan term.',
    formula: 'PMT = P x [r(1 + r)^n] / [(1 + r)^n - 1]',
    whenUse:
      'Use to size loan/mortgage payments, check affordability, or reverse-engineer what a borrower can service — given principal, periodic rate and number of periods.',
    whenNot:
      'Do NOT use for interest-only facilities, balloon structures with uneven payments, or when you need the total interest paid rather than the payment itself.',
    returns: '{ loan_payment: number (currency per period), inputs }.',
    params: [
      { name: 'principal', desc: 'Loan principal amount, e.g. 500000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'rate', desc: 'Periodic interest rate as a decimal, e.g. 0.005 = 0.5% monthly for a 6% annual rate (never pass percentage points). Must match period frequency.', required: true },
      { name: 'periods', desc: 'Total number of payments, e.g. 60 for a 5-year monthly loan. Must be >= 1.', minimum: 1, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.loanPayment,
    order: ['principal', 'rate', 'periods'],
  },

  // ---- FUND RETURN METRICS ----
  {
    name: 'calculate_dpi',
    purpose:
      'Calculate Distributions to Paid-In capital (DPI): cumulative distributions returned to investors divided by paid-in capital — the realised multiple of a fund or investment.',
    formula: 'DPI = Total Distributions / Paid-In Capital',
    whenUse:
      'Use for private equity / venture fund reporting to show how much cash investors have actually received back relative to what they put in.',
    whenNot:
      'Do NOT use to measure total performance — DPI ignores unrealised residual value (pair with RVPI; TVPI = DPI + RVPI captures both).',
    returns: '{ dpi: number (e.g. 0.8 = 0.8x of paid-in returned as cash), inputs }.',
    params: [
      { name: 'distributions', desc: 'Cumulative distributions returned to investors, e.g. 800000. Must be >= 0.', minimum: 0, required: true },
      { name: 'paid_in', desc: 'Paid-in capital contributed by investors, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.dpi,
    order: ['distributions', 'paid_in'],
  },
  {
    name: 'calculate_rvpi',
    purpose:
      'Calculate Residual Value to Paid-In capital (RVPI): the current (unrealised) value of remaining assets divided by paid-in capital.',
    formula: 'RVPI = Residual Value / Paid-In Capital',
    whenUse:
      'Use for fund reporting to show the unrealised multiple still held in the portfolio (mark-to-market or fair value of remaining investments).',
    whenNot:
      'Do NOT use alone as a performance measure — residual value is an estimate, not cash (combine with DPI for the full TVPI picture).',
    returns: '{ rvpi: number (e.g. 1.2 = 1.2x of paid-in still held), inputs }.',
    params: [
      { name: 'residual_value', desc: 'Current fair value of remaining (unrealised) investments, e.g. 1200000. Must be >= 0.', minimum: 0, required: true },
      { name: 'paid_in', desc: 'Paid-in capital contributed by investors, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.rvpi,
    order: ['residual_value', 'paid_in'],
  },
  {
    name: 'calculate_tvpi',
    purpose:
      'Calculate Total Value to Paid-In capital (TVPI): (distributions + residual value) divided by paid-in capital — the total multiple of a fund or investment including both realised and unrealised value.',
    formula: 'TVPI = (Distributions + Residual Value) / Paid-In Capital',
    whenUse:
      'Use as the headline multiple for private equity / venture fund performance (equivalent to DPI + RVPI).',
    whenNot:
      'Do NOT use TVPI to compare funds of different vintages/ages — it ignores the time value of money (use IRR or MOIC-with-hold-period for time-adjusted comparison).',
    returns: '{ tvpi: number (e.g. 2.0 = 2.0x total value on paid-in), inputs }.',
    params: [
      { name: 'distributions', desc: 'Cumulative distributions returned to investors, e.g. 800000. Must be >= 0.', minimum: 0, required: true },
      { name: 'residual_value', desc: 'Current fair value of remaining investments, e.g. 1200000. Must be >= 0.', minimum: 0, required: true },
      { name: 'paid_in', desc: 'Paid-in capital, e.g. 1000000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.tvpi,
    order: ['distributions', 'residual_value', 'paid_in'],
  },

  // ---- PAYBACK ----
  {
    name: 'calculate_payback_period',
    purpose:
      'Calculate the payback period: how many years (including a fractional final year) until cumulative cash flows recover the initial investment, ignoring the time value of money.',
    formula: 'Payback = the year t where cumulative cash flow turns positive',
    whenUse:
      'Use as a quick liquidity/risk screen — shorter payback means capital is at risk for less time. Useful alongside NPV/IRR, never as the sole investment criterion.',
    whenNot:
      'Do NOT use as the primary decision metric — it ignores cash flows after payback, profitability, and the time value of money (use calculate_npv or calculate_irr for those).',
    returns: '{ payback_period_years: number (e.g. 3.4), inputs }. If the cash flows never recover the investment, returns an explicit error stating no payback occurs.',
    params: [
      { name: 'cash_flows', desc: 'Ordered cash flows starting at time 0 (first element is the initial investment, typically negative), e.g. [-250000, 50000, 75000, 100000, 125000]. Must contain at least one negative (investment) followed by inflows.', type: 'array', minItems: 2, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: (flows) => adv.paybackPeriod(flows as number[]),
    order: ['cash_flows'],
    behaviourNote:
      'If cumulative cash flow never turns positive, an explicit error is returned ("investment is never recovered within the provided cash flows") rather than a number.',
  },
  {
    name: 'calculate_discounted_payback_period',
    purpose:
      'Calculate the discounted payback period: how many years until the DISCOUNTED cumulative cash flows recover the initial investment, incorporating the time value of money.',
    formula: 'Discounted payback = the year t where cumulative discounted cash flow turns positive',
    whenUse:
      'Use when you want a payback-style risk screen that still respects the cost of capital — a project can pay back nominally but never on a discounted basis.',
    whenNot:
      'Do NOT use for the final go/no-go decision (it still ignores flows after payback); use calculate_npv for value creation and calculate_irr for return.',
    returns: '{ discounted_payback_period_years: number (e.g. 4.2), inputs }. If the discounted flows never recover the investment, returns an explicit error stating no payback occurs.',
    params: [
      { name: 'cash_flows', desc: 'Ordered cash flows starting at time 0 (first element is the initial investment, typically negative), e.g. [-250000, 50000, 75000, 100000, 125000]. The time-0 flow is not discounted.', type: 'array', minItems: 2, required: true },
      { name: 'rate', desc: 'Discount rate as a decimal, e.g. 0.10 = 10% (never pass percentage points). Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: (flows, rate) => adv.discountedPaybackPeriod(flows as number[], rate as number),
    order: ['cash_flows', 'rate'],
    behaviourNote:
      'If discounted cumulative cash flow never turns positive, an explicit error is returned rather than a number.',
  },

  // ---- ENTERPRISE VALUE & MULTIPLES ----
  {
    name: 'calculate_enterprise_value',
    purpose:
      'Calculate enterprise value (EV): the total value of a business to all capital providers — equity value plus net debt (total debt minus cash and equivalents).',
    formula: 'EV = Equity Value + Total Debt - Cash & Equivalents',
    whenUse:
      'Use as the capital-structure-neutral measure of a company\u2019s total value — the standard starting point for valuation multiples (EV/EBITDA, EV/Revenue) and M&A transaction values.',
    whenNot:
      'Do NOT confuse EV with equity value (market cap) — EV is what you would pay to own the whole enterprise including its debt; use equity value for per-share figures like P/E.',
    returns: '{ enterprise_value: number (currency), inputs }.',
    params: [
      { name: 'equity_value', desc: 'Equity value / market capitalisation, e.g. 5000000. Must be >= 0.', minimum: 0, required: true },
      { name: 'total_debt', desc: 'Total interest-bearing debt (short + long term), e.g. 2000000. Must be >= 0.', minimum: 0, required: true },
      { name: 'cash_and_equivalents', desc: 'Cash and cash equivalents to subtract, e.g. 500000. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.enterpriseValue,
    order: ['equity_value', 'total_debt', 'cash_and_equivalents'],
  },
  {
    name: 'calculate_ev_to_ebitda',
    purpose:
      'Calculate the EV/EBITDA multiple: enterprise value divided by EBITDA — the most widely used valuation multiple for comparing companies independent of capital structure, tax and depreciation policy.',
    formula: 'EV/EBITDA = Enterprise Value / EBITDA',
    whenUse:
      'Use for relative valuation of cash-generative businesses against peer multiples or transaction comps; a lower multiple may indicate relative undervaluation (or justified risk).',
    whenNot:
      'Do NOT use when EBITDA is negative or near zero, or for early-stage companies with no meaningful EBITDA — the multiple is meaningless there (use EV/Revenue).',
    returns: '{ ev_to_ebitda: number (e.g. 8.5 = 8.5x), inputs }.',
    params: [
      { name: 'enterprise_value', desc: 'Enterprise value in currency units, e.g. 10000000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'ebitda', desc: 'Earnings before interest, tax, depreciation and amortisation, e.g. 1200000. Must be > 0 for a meaningful multiple.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.evToEbitda,
    order: ['enterprise_value', 'ebitda'],
  },
  {
    name: 'calculate_ev_to_revenue',
    purpose:
      'Calculate the EV/Revenue (EV/Sales) multiple: enterprise value divided by revenue — a valuation multiple usable for companies with thin, negative or zero EBITDA (e.g. high-growth or pre-profit businesses).',
    formula: 'EV/Revenue = Enterprise Value / Revenue',
    whenUse:
      'Use for valuing pre-profit / high-growth companies, or as a cross-check alongside EV/EBITDA for mature ones.',
    whenNot:
      'Do NOT use revenue multiples alone — they ignore profitability entirely (a company can have a low EV/S and still destroy value); pair with margin and growth context.',
    returns: '{ ev_to_revenue: number (e.g. 3.2 = 3.2x), inputs }.',
    params: [
      { name: 'enterprise_value', desc: 'Enterprise value in currency units, e.g. 10000000. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'revenue', desc: 'Revenue (net sales) over the trailing period, e.g. 3100000. Must be > 0.', exclusiveMinimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 2,
    fn: adv.evToRevenue,
    order: ['enterprise_value', 'revenue'],
  },

  // ---- CAPM & BETA ----
  {
    name: 'calculate_capm_cost_of_equity',
    purpose:
      'Calculate the cost of equity using the Capital Asset Pricing Model (CAPM): the risk-free rate plus beta times the market risk premium.',
    formula: 'Re = Rf + beta x (Rm - Rf)',
    whenUse:
      'Use to estimate the required return on equity — an input to WACC (calculate_wacc) and DCF discount rates, or as a standalone return hurdle.',
    whenNot:
      'Do NOT use for companies where beta is a poor risk measure (private companies without a traded beta — consider building up from comparable betas via calculate_unlever_beta / calculate_relever_beta first).',
    returns: '{ cost_of_equity: decimal (e.g. 0.115 = 11.5%), cost_of_equity_pct: number (e.g. 11.5), inputs }.',
    params: [
      { name: 'risk_free_rate', desc: 'Risk-free rate as a decimal, e.g. 0.04 = 4% (typically the 10-year government bond yield; never pass percentage points).', required: true },
      { name: 'beta', desc: 'Equity beta (levered, if the company has debt), e.g. 1.2. Use unlevered/relevered betas when comparing capital structures.', required: true },
      { name: 'market_return', desc: 'Expected market return (Rm) as a decimal, e.g. 0.10 = 10% (never pass percentage points). The market risk premium is computed internally as Rm - Rf.', required: true },
    ],
    kind: 'pct',
    decimals: 4,
    fn: adv.capmCostOfEquity,
    order: ['risk_free_rate', 'beta', 'market_return'],
  },
  {
    name: 'calculate_unlever_beta',
    purpose:
      'Unlever a (levered) equity beta to its asset beta using the Hamada formula — removing the financial-risk effect of debt so betas of companies with different capital structures can be compared.',
    formula: 'Beta(unlevered) = Beta(levered) / (1 + (1 - tax rate) x Debt/Equity)',
    whenUse:
      'Use when valuing a private company or a deal with a different capital structure than the public comparable — unlever the comps\u2019 betas, average them, then relever at your target structure.',
    whenNot:
      'Do NOT unlever with an inconsistent tax rate or debt/equity ratio — the result is only as clean as its inputs; for companies with significant non-debt liabilities consider a more advanced formula.',
    returns: '{ unlevered_beta: number (e.g. 0.85), inputs }.',
    params: [
      { name: 'levered_beta', desc: 'The observed (levered) equity beta of the comparable company, e.g. 1.2. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'tax_rate', desc: 'Corporate tax rate as a decimal between 0 and 1, e.g. 0.25 = 25%.', minimum: 0, maximum: 1, required: true },
      { name: 'debt_to_equity', desc: 'Debt-to-equity ratio of the company whose beta is being unlevered (market values preferred), e.g. 0.5 = 0.5x. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 4,
    fn: adv.unleverBeta,
    order: ['levered_beta', 'tax_rate', 'debt_to_equity'],
  },
  {
    name: 'calculate_relever_beta',
    purpose:
      'Relever an unlevered (asset) beta to a target capital structure using the Hamada formula — restoring financial risk for the specific debt/equity mix of the company or deal being valued.',
    formula: 'Beta(levered) = Beta(unlevered) x (1 + (1 - tax rate) x Debt/Equity)',
    whenUse:
      'Use AFTER unlevering comparable betas: apply the average unlevered beta to your target company\u2019s (or transaction\u2019s) capital structure to obtain the beta for WACC.',
    whenNot:
      'Do NOT relever onto an unrealistic target structure — extreme leverage produces extreme betas that may overstate risk; sanity-check the resulting cost of equity.',
    returns: '{ levered_beta: number (e.g. 1.15), inputs }.',
    params: [
      { name: 'unlevered_beta', desc: 'Unlevered (asset) beta, e.g. 0.85. Must be > 0.', exclusiveMinimum: 0, required: true },
      { name: 'tax_rate', desc: 'Corporate tax rate as a decimal between 0 and 1, e.g. 0.25 = 25%.', minimum: 0, maximum: 1, required: true },
      { name: 'debt_to_equity', desc: 'Target debt-to-equity ratio (market values preferred), e.g. 0.6 = 0.6x. Must be >= 0.', minimum: 0, required: true },
    ],
    kind: 'plain',
    decimals: 4,
    fn: adv.releverBeta,
    order: ['unlevered_beta', 'tax_rate', 'debt_to_equity'],
  },
];

// ============================================================
// Build ToolDefs + dispatch
// ============================================================

function buildDescription(def: AdvDef): string {
  const purpose = def.purpose.replace(/\s+/g, ' ').trim();
  const paramsText = def.params
    .map((p) => `${p.name} (${p.required ? 'required' : 'optional'}): ${p.desc}`)
    .join(' ');
  return (
    `${purpose} Formula: ${def.formula}. ` +
    `WHEN TO USE: ${def.whenUse} ` +
    `WHEN NOT TO USE: ${def.whenNot} ` +
    (def.behaviourNote ? `BEHAVIOUR: ${def.behaviourNote} ` : BEHAVIOUR) +
    `RETURNS: JSON object ${def.returns} ` +
    `PARAMETERS: ${paramsText}`
  );
}

function buildSchema(def: AdvDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of def.params) {
    if (p.type === 'array') {
      properties[p.name] = {
        type: 'array',
        items: { type: 'number' },
        minItems: p.minItems,
        description: p.desc,
      };
      continue;
    }
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

export const ADVANCED_TOOLS: ToolDef[] = DEFS.map((def) => ({
  name: def.name,
  description: buildDescription(def),
  inputSchema: buildSchema(def),
  annotations: PURE_FN_ANNOTATIONS,
}));

const BY_NAME = new Map(DEFS.map((d) => [d.name, d]));

export function isAdvancedTool(name: string): boolean {
  return BY_NAME.has(name);
}

export function runAdvancedTool(
  name: string,
  args: Record<string, unknown>
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } | undefined {
  const def = BY_NAME.get(name);
  if (!def) return undefined;

  const values: (number | number[])[] = [];
  for (const paramName of def.order) {
    const v = args[paramName];
    if (def.params.find((p) => p.name === paramName)?.type === 'array') {
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'number' && isFinite(x))) {
        return { ok: false, error: `${name} requires ${paramName} to be a non-empty array of numbers` };
      }
      values.push(v as number[]);
    } else {
      if (typeof v !== 'number' || !isFinite(v)) {
        return { ok: false, error: `${name} requires numeric ${paramName}` };
      }
      values.push(v as number);
    }
  }

  const raw = def.fn(...values);
  if (!isFinite(raw)) {
    return {
      ok: false,
      error: `${name}: result is undefined — check inputs (division by zero, rate <= growth in a perpetuity, negative/zero base in CAGR, or an investment that is never recovered)`,
    };
  }

  const rounded = round(raw, def.decimals ?? 2);
  const key = def.name.replace(/^calculate_/, '');
  const result: Record<string, unknown> = { inputs: { ...args } };
  if (def.kind === 'pct') {
    result[key] = rounded;
    result[`${key}_pct`] = round(raw * 100, 2);
  } else {
    result[key] = rounded;
  }
  return { ok: true, value: result };
}
