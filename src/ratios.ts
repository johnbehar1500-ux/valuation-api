/**
 * Valuation API — Financial Ratio Engine (Phase 1)
 *
 * Pure deterministic functions for the standard ratio families:
 * liquidity, leverage, efficiency, profitability, market value.
 *
 * Conventions:
 *  - All functions return numbers; results that are naturally percentages
 *    (margins, ROA/ROE/ROCE/ROIC, ratios like payout) are returned as
 *    DECIMALS (0.25 = 25%) with a parallel *_pct helper where it aids agents.
 *  - Division by zero returns NaN (never throws) — callers surface it.
 *  - Inputs are validated at the MCP dispatch layer; here we only guard math.
 *  - Averages (e.g. average total assets) are computed from two period values.
 *
 * Written from first principles / standard financial practice. No text copied
 * from any third-party source.
 */

// ============================================================
// Helpers
// ============================================================

function safeDivide(numerator: number, denominator: number): number {
  if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return NaN;
  return numerator / denominator;
}

function average(begin: number, end: number): number {
  return (begin + end) / 2;
}

// ============================================================
// LIQUIDITY — short-term payment ability
// ============================================================

/** Current Ratio = Current Assets / Current Liabilities */
export function currentRatio(currentAssets: number, currentLiabilities: number): number {
  return safeDivide(currentAssets, currentLiabilities);
}

/** Quick (Acid-Test) Ratio = (Current Assets - Inventory) / Current Liabilities */
export function quickRatio(currentAssets: number, inventory: number, currentLiabilities: number): number {
  return safeDivide(currentAssets - inventory, currentLiabilities);
}

/** Cash Ratio = (Cash + Marketable Securities) / Current Liabilities */
export function cashRatio(cashAndEquivalents: number, marketableSecurities: number, currentLiabilities: number): number {
  return safeDivide(cashAndEquivalents + marketableSecurities, currentLiabilities);
}

/** Defensive Interval = (Cash + Marketable Securities + Receivables) / Daily Operating Expenses (days) */
export function defensiveInterval(
  cashAndEquivalents: number,
  marketableSecurities: number,
  receivables: number,
  dailyOperatingExpenses: number
): number {
  return safeDivide(cashAndEquivalents + marketableSecurities + receivables, dailyOperatingExpenses);
}

// ============================================================
// LEVERAGE — debt and capital structure
// ============================================================

/** Debt-to-Equity = Total Debt / Shareholders' Equity */
export function debtToEquity(totalDebt: number, shareholdersEquity: number): number {
  return safeDivide(totalDebt, shareholdersEquity);
}

/** Debt-to-Assets = Total Debt / Total Assets */
export function debtToAssets(totalDebt: number, totalAssets: number): number {
  return safeDivide(totalDebt, totalAssets);
}

/** Equity Multiplier = Total Assets / Shareholders' Equity */
export function equityMultiplier(totalAssets: number, shareholdersEquity: number): number {
  return safeDivide(totalAssets, shareholdersEquity);
}

/** Interest Coverage = EBIT (or Operating Income) / Interest Expense */
export function interestCoverage(ebit: number, interestExpense: number): number {
  return safeDivide(ebit, interestExpense);
}

// ============================================================
// EFFICIENCY — asset use and productivity
// ============================================================

/** Asset Turnover = Net Sales / Average Total Assets */
export function assetTurnover(netSales: number, beginTotalAssets: number, endTotalAssets: number): number {
  return safeDivide(netSales, average(beginTotalAssets, endTotalAssets));
}

/** Fixed Asset Turnover = Net Sales / Average Net Fixed Assets */
export function fixedAssetTurnover(netSales: number, beginNetFixedAssets: number, endNetFixedAssets: number): number {
  return safeDivide(netSales, average(beginNetFixedAssets, endNetFixedAssets));
}

/** Inventory Turnover = Cost of Goods Sold / Average Inventory */
export function inventoryTurnover(cogs: number, beginInventory: number, endInventory: number): number {
  return safeDivide(cogs, average(beginInventory, endInventory));
}

/** Receivables Turnover = Net Credit Sales / Average Accounts Receivable */
export function receivablesTurnover(netCreditSales: number, beginReceivables: number, endReceivables: number): number {
  return safeDivide(netCreditSales, average(beginReceivables, endReceivables));
}

/** Payables Turnover = COGS (or Net Purchases) / Average Accounts Payable */
export function payablesTurnover(cogsOrPurchases: number, beginPayables: number, endPayables: number): number {
  return safeDivide(cogsOrPurchases, average(beginPayables, endPayables));
}

/** Days Sales Outstanding (DSO) = 365 / Receivables Turnover */
export function daysSalesOutstanding(netCreditSales: number, beginReceivables: number, endReceivables: number): number {
  return safeDivide(365, receivablesTurnover(netCreditSales, beginReceivables, endReceivables));
}

/** Days Inventory Outstanding (DIO) = 365 / Inventory Turnover */
export function daysInventoryOutstanding(cogs: number, beginInventory: number, endInventory: number): number {
  return safeDivide(365, inventoryTurnover(cogs, beginInventory, endInventory));
}

/** Days Payables Outstanding (DPO) = 365 / Payables Turnover */
export function daysPayablesOutstanding(cogsOrPurchases: number, beginPayables: number, endPayables: number): number {
  return safeDivide(365, payablesTurnover(cogsOrPurchases, beginPayables, endPayables));
}

/** Cash Conversion Cycle = DSO + DIO - DPO (days) */
export function cashConversionCycle(dso: number, dio: number, dpo: number): number {
  return dso + dio - dpo;
}

// ============================================================
// PROFITABILITY — profit relative to sales, assets, or equity
// ============================================================

/** Gross Margin = Gross Profit / Net Sales (decimal) */
export function grossMargin(grossProfit: number, netSales: number): number {
  return safeDivide(grossProfit, netSales);
}

/** Operating Margin = Operating Income / Net Sales (decimal) */
export function operatingMargin(operatingIncome: number, netSales: number): number {
  return safeDivide(operatingIncome, netSales);
}

/** Net Margin = Net Income / Net Sales (decimal) */
export function netMargin(netIncome: number, netSales: number): number {
  return safeDivide(netIncome, netSales);
}

/** Return on Assets (ROA) = Net Income / Average Total Assets (decimal) */
export function roa(netIncome: number, beginTotalAssets: number, endTotalAssets: number): number {
  return safeDivide(netIncome, average(beginTotalAssets, endTotalAssets));
}

/** Return on Equity (ROE) = Net Income / Average Shareholders' Equity (decimal) */
export function roe(netIncome: number, beginEquity: number, endEquity: number): number {
  return safeDivide(netIncome, average(beginEquity, endEquity));
}

/** Return on Capital Employed (ROCE) = EBIT / (Total Assets - Current Liabilities) (decimal) */
export function roce(ebit: number, totalAssets: number, currentLiabilities: number): number {
  return safeDivide(ebit, totalAssets - currentLiabilities);
}

/** Return on Invested Capital (ROIC) = NOPAT / Invested Capital (decimal) */
export function roic(nopat: number, investedCapital: number): number {
  return safeDivide(nopat, investedCapital);
}

// ============================================================
// MARKET VALUE — valuation and investor returns
// ============================================================

/** Earnings Per Share (EPS) = Net Income / Weighted Average Shares Outstanding */
export function eps(netIncome: number, weightedAvgSharesOutstanding: number): number {
  return safeDivide(netIncome, weightedAvgSharesOutstanding);
}

/** Price-to-Earnings (P/E) = Share Price / EPS */
export function peRatio(sharePrice: number, earningsPerShare: number): number {
  return safeDivide(sharePrice, earningsPerShare);
}

/** Price-to-Book (P/B) = Share Price / Book Value Per Share */
export function pbRatio(sharePrice: number, bookValuePerShare: number): number {
  return safeDivide(sharePrice, bookValuePerShare);
}

/** Dividend Yield = Annual Dividends Per Share / Share Price (decimal) */
export function dividendYield(annualDividendsPerShare: number, sharePrice: number): number {
  return safeDivide(annualDividendsPerShare, sharePrice);
}

/** Payout Ratio = Dividends Per Share / EPS (decimal) */
export function payoutRatio(dividendsPerShare: number, earningsPerShare: number): number {
  return safeDivide(dividendsPerShare, earningsPerShare);
}
