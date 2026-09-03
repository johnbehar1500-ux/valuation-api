/**
 * Valuation API — Advanced Valuation Engine (Phase 2)
 *
 * Pure deterministic functions: time value of money, fund-return metrics,
 * payback analysis, enterprise value & multiples, CAPM and beta unlevering/
 * relevering (Hamada). No text copied from third-party sources.
 *
 * Conventions:
 *  - Rates are DECIMALS (0.10 = 10%), never percentage points.
 *  - Periods and cash flows must share a consistent frequency (annual in,
 *    annual out; monthly in, monthly out).
 *  - Division by zero / undefined results return NaN — surfaced as errors
 *    at the dispatch layer, never thrown.
 */

import { tvpi as tvpiFn } from './calculate';

function safeDivide(n: number, d: number): number {
  if (!isFinite(n) || !isFinite(d) || d === 0) return NaN;
  return n / d;
}

// ============================================================
// TIME VALUE OF MONEY
// ============================================================

/** FV = PV x (1 + r)^n */
export function futureValue(presentValue: number, rate: number, periods: number): number {
  return presentValue * Math.pow(1 + rate, periods);
}

/** PV = FV / (1 + r)^n */
export function presentValue(futureValueAmount: number, rate: number, periods: number): number {
  return safeDivide(futureValueAmount, Math.pow(1 + rate, periods));
}

/** CAGR = (End / Begin)^(1/n) - 1 */
export function cagr(beginValue: number, endValue: number, periods: number): number {
  if (beginValue <= 0 || periods <= 0) return NaN;
  return Math.pow(safeDivide(endValue, beginValue), 1 / periods) - 1;
}

/** Ordinary annuity PV = PMT x (1 - (1+r)^-n) / r ; rate = 0 -> PMT x n */
export function annuityPresentValue(payment: number, rate: number, periods: number): number {
  if (periods <= 0) return NaN;
  if (rate === 0) return payment * periods;
  return (payment * (1 - Math.pow(1 + rate, -periods))) / rate;
}

/** Perpetuity PV = CF / r ; growing perpetuity = CF / (r - g), requires r > g */
export function perpetuityValue(cashFlow: number, rate: number, growthRate = 0): number {
  // r <= g has no finite value (negative or infinite implied worth) — surface NaN
  if (rate <= growthRate) return NaN;
  return safeDivide(cashFlow, rate - growthRate);
}

/** Loan payment (PMT): P x [r(1+r)^n] / [(1+r)^n - 1] ; rate = 0 -> P / n */
export function loanPayment(principal: number, rate: number, periods: number): number {
  if (periods <= 0) return NaN;
  if (rate === 0) return safeDivide(principal, periods);
  const f = Math.pow(1 + rate, periods);
  return safeDivide(principal * rate * f, f - 1);
}

// ============================================================
// FUND RETURN METRICS (DPI / RVPI / TVPI)
// ============================================================

/** DPI = total distributions / paid-in capital */
export function dpi(distributions: number, paidIn: number): number {
  return safeDivide(distributions, paidIn);
}

/** RVPI = residual value / paid-in capital */
export function rvpi(residualValue: number, paidIn: number): number {
  return safeDivide(residualValue, paidIn);
}

/** TVPI = (distributions + residual value) / paid-in capital */
export function tvpi(distributions: number, residualValue: number, paidIn: number): number {
  return tvpiFn(distributions, residualValue, paidIn);
}

// ============================================================
// PAYBACK ANALYSIS
// ============================================================

/**
 * Payback period (years, fractional) from an ordered cash-flow schedule.
 * Cash flows start at time 0 (typically the negative investment). Returns
 * the fraction of the year in which cumulative cash flow turns positive,
 * or NaN if the investment never pays back.
 */
export function paybackPeriod(cashFlows: number[]): number {
  let cumulative = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    const prev = cumulative;
    cumulative += cashFlows[t];
    if (cumulative >= 0 && t > 0) {
      const needed = -prev;
      const inflow = cashFlows[t];
      if (inflow <= 0) return NaN;
      return t - 1 + safeDivide(needed, inflow);
    }
  }
  return NaN;
}

/**
 * Discounted payback period (years, fractional): same as paybackPeriod but
 * each cash flow is discounted at `rate` (time-0 flow undiscounted).
 */
export function discountedPaybackPeriod(cashFlows: number[], rate: number): number {
  const discounted = cashFlows.map((cf, t) => safeDivide(cf, Math.pow(1 + rate, t)));
  return paybackPeriod(discounted);
}

// ============================================================
// ENTERPRISE VALUE & MULTIPLES
// ============================================================

/** EV = equity value + total debt - cash & equivalents */
export function enterpriseValue(equityValue: number, totalDebt: number, cashAndEquivalents: number): number {
  return equityValue + totalDebt - cashAndEquivalents;
}

/** EV/EBITDA multiple */
export function evToEbitda(enterpriseValueAmount: number, ebitda: number): number {
  return safeDivide(enterpriseValueAmount, ebitda);
}

/** EV/Revenue multiple */
export function evToRevenue(enterpriseValueAmount: number, revenue: number): number {
  return safeDivide(enterpriseValueAmount, revenue);
}

// ============================================================
// CAPM & BETA (HAMADA)
// ============================================================

/** Cost of equity (CAPM): Re = Rf + beta x (Rm - Rf) */
export function capmCostOfEquity(riskFreeRate: number, beta: number, marketReturn: number): number {
  return riskFreeRate + beta * (marketReturn - riskFreeRate);
}

/** Unlever beta: Bu = Bl / (1 + (1 - t) x D/E) */
export function unleverBeta(leveredBeta: number, taxRate: number, debtToEquity: number): number {
  return safeDivide(leveredBeta, 1 + (1 - taxRate) * debtToEquity);
}

/** Relever beta: Bl = Bu x (1 + (1 - t) x D/E) */
export function releverBeta(unleveredBeta: number, taxRate: number, debtToEquity: number): number {
  return unleveredBeta * (1 + (1 - taxRate) * debtToEquity);
}
