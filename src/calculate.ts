/**
 * Valuation API — Calculation Engine
 * 
 * Pure math functions for IRR, NPV, MOIC, DCF, and sensitivity analysis.
 * No external dependencies — runs natively in Cloudflare Workers.
 */

// ============================================================
// Core Calculations
// ============================================================

/**
 * Net Present Value (NPV)
 * NPV = Σ(CF_t / (1+r)^t) - Initial Investment
 */
export function npv(rate: number, cashFlows: number[]): number {
  return cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/**
 * Internal Rate of Return (IRR)
 * The rate r where NPV(r, cashFlows) = 0
 * 
 * Uses Newton-Raphson method with bisection fallback.
 */
export function irr(cashFlows: number[], guess: number = 0.1): number {
  // Newton-Raphson method
  const maxIterations = 100;
  const tolerance = 1e-7;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    const f = npv(rate, cashFlows);
    if (Math.abs(f) < tolerance) return rate;

    // Derivative: dNPV/dr = Σ(-t * CF_t / (1+r)^(t+1))
    const df = cashFlows.reduce(
      (acc, cf, t) => acc + (-t * cf) / Math.pow(1 + rate, t + 1),
      0
    );

    if (Math.abs(df) < 1e-10) break; // Derivative too small, fall back to bisection

    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < tolerance) return newRate;
    rate = newRate;
  }

  // Fallback: bisection method
  return irrBisection(cashFlows);
}

/**
 * IRR via bisection — robust fallback when Newton-Raphson fails.
 */
function irrBisection(cashFlows: number[]): number {
  let low = -0.999;
  let high = 10.0; // 1000% upper bound
  const tolerance = 1e-7;
  const maxIterations = 200;

  // Ensure there's a sign change (NPV crosses zero)
  const npvLow = npv(low, cashFlows);
  const npvHigh = npv(high, cashFlows);

  if (npvLow * npvHigh > 0) {
    // No sign change — check if all cash flows are positive or negative
    const sum = cashFlows.reduce((a, b) => a + b, 0);
    if (sum > 0) return Infinity; // All positive — infinite return
    return NaN; // No valid IRR
  }

  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const npvMid = npv(mid, cashFlows);

    if (Math.abs(npvMid) < tolerance) return mid;

    if (npvMid * npv(low, cashFlows) < 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return (low + high) / 2;
}

/**
 * Multiple on Invested Capital (MOIC)
 * MOIC = Total Distributions / Total Invested
 */
export function moic(cashFlows: number[]): number {
  const invested = cashFlows.filter((cf) => cf < 0).reduce((a, b) => a + Math.abs(b), 0);
  const returned = cashFlows.filter((cf) => cf > 0).reduce((a, b) => a + b, 0);
  return invested > 0 ? returned / invested : 0;
}

/**
 * Total Value to Paid-In (TVPI)
 * Same as MOIC when no ongoing value — included for completeness.
 */
export function tvpi(distributions: number, residualValue: number, paidIn: number): number {
  return paidIn > 0 ? (distributions + residualValue) / paidIn : 0;
}

/**
 * Discounted Cash Flow (DCF) Valuation
 * Value = Σ(FCF_t / (1+WACC)^t) + Terminal Value / (1+WACC)^n
 * Terminal Value = FCF_n * (1 + g) / (WACC - g)
 */
export function dcf(
  freeCashFlows: number[],
  wacc: number,
  terminalGrowthRate: number
): { presentValue: number; terminalValue: number; enterpriseValue: number } {
  const n = freeCashFlows.length;
  
  // Present value of explicit cash flows
  const presentValue = freeCashFlows.reduce(
    (acc, fcf, t) => acc + fcf / Math.pow(1 + wacc, t + 1),
    0
  );

  // Terminal Value (Gordon Growth Model)
  const lastFCF = freeCashFlows[n - 1];
  const terminalValue = lastFCF * (1 + terminalGrowthRate) / (wacc - terminalGrowthRate);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, n);

  const enterpriseValue = presentValue + pvTerminal;

  return {
    presentValue: round(presentValue, 2),
    terminalValue: round(terminalValue, 2),
    enterpriseValue: round(enterpriseValue, 2),
  };
}

/**
 * Weighted Average Cost of Capital (WACC)
 * WACC = (E/V) * Re + (D/V) * Rd * (1 - Tax)
 */
export function wacc(
  equityValue: number,
  debtValue: number,
  costOfEquity: number,
  costOfDebt: number,
  taxRate: number
): number {
  const v = equityValue + debtValue;
  if (v === 0) return 0;
  return (equityValue / v) * costOfEquity + (debtValue / v) * costOfDebt * (1 - taxRate);
}

// ============================================================
// Sensitivity Analysis
// ============================================================

/**
 * IRR sensitivity to different exit multiples and hold periods.
 */
export function irrSensitivity(
  initialInvestment: number,
  exitMultiples: number[] = [1.5, 2.0, 2.5, 3.0, 3.5],
  holdPeriods: number[] = [3, 5, 7, 10]
): {
  byMultiple: Record<string, number>;
  byHoldPeriod: Record<string, number>;
} {
  const byMultiple: Record<string, number> = {};
  const byHoldPeriod: Record<string, number> = {};

  for (const mult of exitMultiples) {
    const cashFlows = Array(holdPeriods[1]).fill(0); // Default to 5-year hold
    cashFlows[0] = -initialInvestment;
    cashFlows[holdPeriods[1]] = initialInvestment * mult;
    byMultiple[`${mult}x`] = round(irr(cashFlows) * 100, 1);
  }

  for (const years of holdPeriods) {
    const cashFlows = Array(years + 1).fill(0);
    cashFlows[0] = -initialInvestment;
    cashFlows[years] = initialInvestment * 2.5; // Default to 2.5x exit
    byHoldPeriod[`${years}y`] = round(irr(cashFlows) * 100, 1);
  }

  return { byMultiple, byHoldPeriod };
}

// ============================================================
// Formatting Helpers
// ============================================================

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function formatCurrency(value: number, currency: string = "GBP"): string {
  const symbols: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
  const symbol = symbols[currency] || "";
  return `${symbol}${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

// ============================================================
// API Response Builders
// ============================================================

export interface IRRRequest {
  initial_investment: number;
  exit_value: number;
  hold_period: number;
  currency?: string;
  exit_multiples?: number[];
  hold_periods?: number[];
}

export function buildIRRResponse(req: IRRRequest) {
  const { initial_investment, exit_value, hold_period, currency = "GBP" } = req;

  // Build cash flow array: [-investment, 0, 0, ..., exit_value]
  const cashFlows = Array(hold_period + 1).fill(0);
  cashFlows[0] = -initial_investment;
  cashFlows[hold_period] = exit_value;

  const irrValue = irr(cashFlows);
  const moicValue = moic(cashFlows);
  const sensitivity = irrSensitivity(
    initial_investment,
    req.exit_multiples || [1.5, 2.0, 2.5, 3.0, 3.5],
    req.hold_periods || [3, 5, 7, 10]
  );

  return {
    concept: "Internal Rate of Return (IRR)",
    definition: "The annualized rate of return that makes the Net Present Value (NPV) of all cash flows equal to zero.",
    formula: "NPV = Σ(CF_t / (1+IRR)^t) - Initial Investment = 0",
    calculation: {
      initial_investment: formatCurrency(initial_investment, currency),
      exit_value: formatCurrency(exit_value, currency),
      hold_period: `${hold_period} years`,
      irr: `${round(irrValue * 100, 1)}%`,
      moic: `${round(moicValue, 2)}x`,
      cash_flows: cashFlows,
    },
    interpretation: buildIRRInterpretation(irrValue, moicValue, hold_period),
    sensitivity,
    expert_source: "Prospect Capital — prospectcapital.com",
  };
}

function buildIRRInterpretation(irrValue: number, moicValue: number, holdPeriod: number): string {
  const irrPct = irrValue * 100;
  let benchmark = "";
  let assessment = "";

  if (irrPct >= 30) {
    benchmark = "top-quartile venture capital returns";
    assessment = "exceptional — typical of successful Series A/B investments or leveraged buyouts with significant value creation";
  } else if (irrPct >= 20) {
    benchmark = "standard venture capital target (20-30%)";
    assessment = "strong — meets typical growth equity and late-stage VC return thresholds";
  } else if (irrPct >= 15) {
    benchmark = "private equity benchmark (15-20%)";
    assessment = "solid — meets standard PE return expectations, typical of mature buyout or growth investments";
  } else if (irrPct >= 8) {
    benchmark = "public market equivalent (8-15%)";
    assessment = "moderate — comparable to or slightly above long-term public equity returns, may not justify illiquidity of private markets";
  } else {
    benchmark = "below public market returns";
    assessment = "weak — does not meet typical private markets return hurdles";
  }

  return `A ${irrPct.toFixed(1)}% IRR over ${holdPeriod} years with a ${moicValue.toFixed(2)}x MOIC is ${assessment}. This falls in the range of ${benchmark}.`;
}
