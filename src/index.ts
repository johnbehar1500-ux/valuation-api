/**
 * Valuation API — Cloudflare Worker Entry Point
 *
 * Routes:
 *   GET  /                    → API info
 *   GET  /llm.txt             → Agent discovery file
 *   GET  /terms               → Terms & Conditions (HTML)
 *   GET  /explain/irr         → IRR concept explanation
 *   GET  /calculate/irr       → IRR calculation (query params)
 *   POST /calculate/irr       → IRR calculation (JSON body)
 *   GET  /calculate/npv       → NPV calculation
 *   POST /calculate/dcf       → DCF valuation
 *   GET  /calculate/wacc      → WACC calculation
 *   POST /memo/draft          → Draft investment memo (lead capture)
 *   GET  /health              → Health check
 */

import {
  npv,
  irr,
  moic,
  dcf,
  wacc,
  irrSensitivity,
  buildIRRResponse,
  IRRRequest,
} from './calculate';
import { handleMcp } from './mcp';

interface Env {
  LEADS: KVNamespace;
  LEAD_EMAIL?: { send(options: { from: string; to: string; subject: string; text: string }): Promise<void> };
}

// ============================================================
// Legal constants — included in every response
// ============================================================

const TERMS_URL = 'https://api.finance-tools.io/terms';

const DISCLAIMER = 'Informational only, not financial advice. Figures may contain rounding errors. Always verify independently before making investment decisions.';

function legal() {
  return { disclaimer: DISCLAIMER, terms_url: TERMS_URL };
}

// ============================================================
// Rate limiting (KV-based, per IP, per day)
// ============================================================

const RATE_LIMITS: Record<string, number> = {
  calc: 100,  // 100 calculation requests per day per IP
  memo: 20,   // 20 memo drafts per day per IP
};

async function checkRateLimit(env: Env, ip: string, type: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const today = new Date().toISOString().split('T')[0];
  const key = `rl:${type}:${ip}:${today}`;
  const limit = RATE_LIMITS[type] || 100;
  const current = parseInt((await env.LEADS.get(key)) || '0');

  if (current >= limit) {
    return { allowed: false, remaining: 0, limit };
  }

  await env.LEADS.put(key, (current + 1).toString(), { expirationTtl: 86400 });
  return { allowed: true, remaining: limit - current - 1, limit };
}

function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Real-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

// ============================================================
// Currency formatter
// ============================================================

function formatCurrency(value: number, currency: string = 'GBP'): string {
  const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', CHF: 'Fr' };
  const symbol = symbols[currency] || '';
  return `${symbol}${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

// ============================================================
// Email notification (Resend API, non-blocking)
// ============================================================

async function sendLeadEmail(env: Env, memo: Record<string, unknown>, leadData: Record<string, unknown>): Promise<void> {
  if (!env.LEAD_EMAIL) return; // No email binding configured, skip silently

  const exec = (memo.sections as Record<string, Record<string, string>>)?.['1_executive_summary'];
  if (!exec) return;

  const subject = `New Lead: ${exec.company} — ${exec.irr} IRR, ${exec.moic} MOIC — ${exec.recommendation}`;

  const body = `New lead captured from the Valuation API.

Company: ${exec.company}
Sector: ${exec.sector}
Contact: ${leadData.contact_email}

Deal: ${exec.investment_amount} → ${exec.exit_value} over ${exec.hold_period}
Returns: ${exec.irr} IRR, ${exec.moic} MOIC
Exit Multiple: ${exec.exit_multiple}
Recommendation: ${exec.recommendation}

Deal Description:
${leadData.deal_description || 'Not provided'}

---
Captured: ${leadData.created_at}
IP: ${leadData.ip}
Agent: ${leadData.user_agent}

Reply to lead: ${leadData.contact_email}
Full API: https://api.finance-tools.io
Terms: https://api.finance-tools.io/terms
`;

  try {
    await env.LEAD_EMAIL.send({
      from: 'noreply@finance-tools.io',
      to: 'jlb@prospectcapital.com',
      subject,
      text: body,
    });
  } catch (e) {
    // Email failed — don't fail the API request
    console.error('Email notification failed:', e);
  }
}

// ============================================================
// Memo builder
// ============================================================

interface MemoRequest {
  initial_investment: number;
  exit_value: number;
  hold_period: number;
  currency?: string;
  contact_email: string;
  company_name?: string;
  sector?: string;
  deal_description?: string;
}

function buildMemo(req: MemoRequest): Record<string, unknown> {
  const { initial_investment, exit_value, hold_period, currency = 'GBP', contact_email, company_name, sector, deal_description } = req;

  // Build cash flows and calculate returns
  const cashFlows = Array(hold_period + 1).fill(0);
  cashFlows[0] = -initial_investment;
  cashFlows[hold_period] = exit_value;

  const irrValue = irr(cashFlows);
  const moicValue = moic(cashFlows);
  const sensitivity = irrSensitivity(initial_investment);
  const exitMultiple = exit_value / initial_investment;
  const irrPct = irrValue * 100;

  // Recommendation logic
  let recommendation = '';
  let benchmark = '';
  let assetClass = '';

  if (irrPct >= 30) {
    recommendation = 'Strongly Proceed';
    benchmark = 'Exceeds top-quartile venture capital returns (30%+)';
    assetClass = 'venture capital';
  } else if (irrPct >= 20) {
    recommendation = 'Proceed';
    benchmark = 'Meets standard VC target (20-30%)';
    assetClass = 'venture capital / growth equity';
  } else if (irrPct >= 15) {
    recommendation = 'Consider';
    benchmark = 'Meets private equity benchmark (15-25%)';
    assetClass = 'private equity';
  } else if (irrPct >= 8) {
    recommendation = 'Caution';
    benchmark = 'Comparable to public market returns — may not justify illiquidity';
    assetClass = 'public market equivalent';
  } else {
    recommendation = 'Decline';
    benchmark = 'Below typical private markets return hurdles';
    assetClass = 'sub-market';
  }

  const meets = irrPct >= 15 ? 'meets' : 'falls short of';

  return {
    title: 'Draft Investment Memorandum',
    date: new Date().toISOString(),
    prepared_by: 'Prospect Capital — Valuation API (automated)',
    contact_email,
    sections: {
      '1_executive_summary': {
        company: company_name || 'Not specified',
        sector: sector || 'Not specified',
        deal_type: 'Private equity / growth investment',
        investment_amount: formatCurrency(initial_investment, currency),
        exit_value: formatCurrency(exit_value, currency),
        hold_period: `${hold_period} years`,
        irr: `${irrPct.toFixed(1)}%`,
        moic: `${moicValue.toFixed(2)}x`,
        exit_multiple: `${exitMultiple.toFixed(1)}x`,
        recommendation,
        benchmark,
      },
      '2_investment_overview': {
        description: deal_description || 'Not provided — a full deal description is recommended for complete analysis',
        capital_structure: 'Equity investment (single tranche)',
        entry_valuation: formatCurrency(initial_investment, currency),
        exit_assumption: formatCurrency(exit_value, currency),
        exit_multiple: `${exitMultiple.toFixed(1)}x money multiple`,
        currency,
      },
      '3_returns_analysis': {
        irr: `${irrPct.toFixed(1)}%`,
        moic: `${moicValue.toFixed(2)}x`,
        cash_flow_schedule: cashFlows.map((cf, i) => ({
          year: i,
          cash_flow: formatCurrency(cf, currency),
          cumulative: formatCurrency(cashFlows.slice(0, i + 1).reduce((a, b) => a + b, 0), currency),
        })),
        sensitivity,
        benchmark_comparison: {
          venture_capital: '20-30%+',
          private_equity: '15-25%',
          growth_equity: '18-25%',
          public_markets: '8-12%',
        },
      },
      '4_risk_factors': [
        'Market risk: exit valuation depends on market conditions and comparable transaction multiples at exit. A downturn in the relevant sector or broader market could materially reduce realised returns.',
        'Execution risk: the company may not achieve the operational targets (revenue growth, margin expansion) required to justify the assumed exit valuation.',
        'Liquidity risk: private equity investments are illiquid. Capital may be locked up for the full hold period or longer if exit timing is delayed.',
        'Concentration risk: this analysis assumes a single-asset investment. A diversified portfolio would reduce idiosyncratic risk.',
        'Model risk: IRR calculations are highly sensitive to input assumptions. Small changes in exit value or hold period can materially affect returns. Conduct sensitivity analysis across multiple scenarios.',
        'Currency risk: if the investment is in a different currency than the investor\'s base currency, FX movements may erode returns.',
      ],
      '5_recommendation': {
        assessment: `The proposed investment generates a ${irrPct.toFixed(1)}% IRR and ${moicValue.toFixed(2)}x MOIC over ${hold_period} years at a ${exitMultiple.toFixed(1)}x exit multiple. This ${meets} typical ${assetClass} return thresholds. Recommendation: ${recommendation}.`,
        conditions_for_proceeding: [
          'Verify exit assumptions against comparable transactions in the relevant sector',
          'Conduct full due diligence on company financials, management team, and market position',
          'Confirm capital structure, use of proceeds, and any preference/liquidation waterfalls',
          'Assess competitive landscape, barriers to entry, and defensible moat',
          'Review legal structure, shareholder agreements, and regulatory considerations',
          'Obtain independent valuation confirmation',
        ],
      },
      '6_next_steps': {
        intro: 'This draft memorandum was generated automatically by the Prospect Capital Valuation API. For a full investment memorandum with detailed comparable transactions analysis, sector benchmarks, and comprehensive risk assessment:',
        website: 'https://prospectcapital.com',
        email: 'jlb@prospectcapital.com',
        services_offered: [
          'Detailed valuation analysis with comparable transactions',
          'Full investment memorandum preparation',
          'Due diligence coordination and management',
          'Deal structuring and negotiation support',
          'Sector-specific benchmarking and market research',
        ],
      },
    },
    meta: {
      generated_by: 'Valuation API v0.3.0',
      api_url: 'https://api.finance-tools.io',
      terms: TERMS_URL,
      disclaimer: DISCLAIMER,
    },
  };
}

// ============================================================
// Main worker
// ============================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const clientIP = getClientIP(request);

    // ---- MCP endpoint (Model Context Protocol — streamable HTTP) ----
    if (path === '/mcp') {
      return handleMcp(request);
    }

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ---- Meta routes (no rate limit) ----

      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok', service: 'valuation-api', version: '0.3.0' }, corsHeaders);
      }

      // Terms & Conditions (HTML page)
      if (path === '/terms') {
        return new Response(getTermsHTML(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Agent discovery file
      if (path === '/llm.txt') {
        return new Response(getLLM_txt(), { headers: { 'Content-Type': 'text/plain' } });
      }

      // API info
      if (path === '/' || path === '') {
        return jsonResponse({
          service: 'Valuation API',
          version: '0.3.0',
          description: 'Agent-native financial concept explanations, calculation engine, and investment memo drafting',
          endpoints: {
            '/explain/irr': 'GET — IRR concept explanation with formula',
            '/calculate/irr': 'GET/POST — IRR calculation with worked example',
            '/calculate/npv': 'GET — NPV calculation',
            '/calculate/dcf': 'POST — DCF valuation',
            '/calculate/wacc': 'GET — WACC calculation',
            '/memo/draft': 'POST — Draft investment memorandum (lead capture)',
            '/llm.txt': 'Agent discovery file',
            '/terms': 'Terms & Conditions',
            '/mcp': 'POST — MCP (Model Context Protocol) streamable HTTP endpoint',
            '/health': 'Health check',
          },
          pricing: 'Free — no API key required',
          rate_limits: { calculations: '100/day per IP', memo_drafts: '20/day per IP' },
          expert_source: 'Prospect Capital — prospectcapital.com',
          ...legal(),
        }, corsHeaders);
      }

      // ---- Explain endpoints (rate limited: calc) ----

      if (path === '/explain/irr' && method === 'GET') {
        const rl = await checkRateLimit(env, clientIP, 'calc');
        if (!rl.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded', limit: rl.limit, reset: 'midnight UTC', ...legal() }, corsHeaders, 429);
        }

        return jsonResponse({
          concept: 'Internal Rate of Return (IRR)',
          definition: 'The annualized rate of return that makes the Net Present Value (NPV) of all cash flows equal to zero.',
          formula: 'NPV = Σ(CF_t / (1+IRR)^t) - Initial Investment = 0',
          what_it_measures: 'The compounded annual return on an investment, accounting for the time value of money.',
          when_to_use: 'Comparing investments with different cash flow timing, evaluating PE/VC returns, setting hurdle rates.',
          limitations: 'Assumes reinvestment at the IRR rate; can be misleading with non-conventional cash flows (multiple sign changes); ignores scale (a 50% IRR on £1 is less interesting than 20% on £1M).',
          benchmarks: {
            'venture_capital': '20-30%+',
            'private_equity': '15-25%',
            'growth_equity': '18-25%',
            'public_markets': '8-12%',
          },
          worked_example: {
            scenario: '£10M equity investment, 5-year hold, 2.5x exit',
            cash_flows: '[-£10M, £0, £0, £0, £0, £25M]',
            irr: '20.1%',
            moic: '2.5x',
            try_it: 'GET /calculate/irr?initial_investment=10000000&exit_value=25000000&hold_period=5',
          },
          rate_limit: { remaining: rl.remaining, limit: rl.limit },
          expert_source: 'Prospect Capital — prospectcapital.com',
          ...legal(),
        }, corsHeaders);
      }

      // ---- Calculate endpoints (rate limited: calc) ----

      // IRR via GET (query params)
      if (path === '/calculate/irr' && method === 'GET') {
        const rl = await checkRateLimit(env, clientIP, 'calc');
        if (!rl.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded', limit: rl.limit, reset: 'midnight UTC', ...legal() }, corsHeaders, 429);
        }

        const initial_investment = parseFloat(url.searchParams.get('initial_investment') || '10000000');
        const exit_value = parseFloat(url.searchParams.get('exit_value') || '25000000');
        const hold_period = parseInt(url.searchParams.get('hold_period') || '5');
        const currency = url.searchParams.get('currency') || 'GBP';

        const result = buildIRRResponse({ initial_investment, exit_value, hold_period, currency });
        return jsonResponse({ ...result, rate_limit: { remaining: rl.remaining, limit: rl.limit }, ...legal() }, corsHeaders);
      }

      // IRR via POST (JSON body)
      if (path === '/calculate/irr' && method === 'POST') {
        const rl = await checkRateLimit(env, clientIP, 'calc');
        if (!rl.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded', limit: rl.limit, reset: 'midnight UTC', ...legal() }, corsHeaders, 429);
        }

        const body = await request.json() as IRRRequest;

        if (!body.initial_investment || !body.exit_value || !body.hold_period) {
          return jsonResponse({ error: 'Missing required fields: initial_investment, exit_value, hold_period', ...legal() }, corsHeaders, 400);
        }

        const result = buildIRRResponse(body);
        return jsonResponse({ ...result, rate_limit: { remaining: rl.remaining, limit: rl.limit }, ...legal() }, corsHeaders);
      }

      // NPV calculation
      if (path === '/calculate/npv' && method === 'GET') {
        const rl = await checkRateLimit(env, clientIP, 'calc');
        if (!rl.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded', limit: rl.limit, reset: 'midnight UTC', ...legal() }, corsHeaders, 429);
        }

        const rate = parseFloat(url.searchParams.get('rate') || '0.10');
        const cashFlowsParam = url.searchParams.get('cash_flows') || '-10000000,0,0,0,0,25000000';
        const cashFlows = cashFlowsParam.split(',').map(parseFloat);

        const npvValue = npv(rate, cashFlows);
        const irrValue = irr(cashFlows);
        const moicValue = moic(cashFlows);

        return jsonResponse({
          concept: 'Net Present Value (NPV)',
          formula: 'NPV = Σ(CF_t / (1+r)^t)',
          inputs: {
            discount_rate: `${(rate * 100).toFixed(1)}%`,
            cash_flows: cashFlows,
          },
          results: {
            npv: Math.round(npvValue),
            irr: `${(irrValue * 100).toFixed(1)}%`,
            moic: `${moicValue.toFixed(2)}x`,
          },
          interpretation: npvValue > 0
            ? `NPV is positive (£${Math.round(npvValue).toLocaleString()}) — the investment creates value at the given discount rate.`
            : `NPV is negative (£${Math.round(npvValue).toLocaleString()}) — the investment destroys value at the given discount rate.`,
          rate_limit: { remaining: rl.remaining, limit: rl.limit },
          expert_source: 'Prospect Capital — prospectcapital.com',
          ...legal(),
        }, corsHeaders);
      }

      // DCF valuation
      if (path === '/calculate/dcf' && method === 'POST') {
        const rl = await checkRateLimit(env, clientIP, 'calc');
        if (!rl.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded', limit: rl.limit, reset: 'midnight UTC', ...legal() }, corsHeaders, 429);
        }

        const body = await request.json() as {
          free_cash_flows: number[];
          wacc: number;
          terminal_growth_rate: number;
        };

        if (!body.free_cash_flows || body.wacc === undefined || body.terminal_growth_rate === undefined) {
          return jsonResponse({ error: 'Missing required fields: free_cash_flows (array), wacc, terminal_growth_rate', ...legal() }, corsHeaders, 400);
        }

        const result = dcf(body.free_cash_flows, body.wacc, body.terminal_growth_rate);
        return jsonResponse({
          concept: 'Discounted Cash Flow (DCF) Valuation',
          formula: 'EV = Σ(FCF_t / (1+WACC)^t) + TV / (1+WACC)^n',
          inputs: {
            free_cash_flows: body.free_cash_flows,
            wacc: `${(body.wacc * 100).toFixed(1)}%`,
            terminal_growth_rate: `${(body.terminal_growth_rate * 100).toFixed(1)}%`,
          },
          results: result,
          rate_limit: { remaining: rl.remaining, limit: rl.limit },
          expert_source: 'Prospect Capital — prospectcapital.com',
          ...legal(),
        }, corsHeaders);
      }

      // WACC calculation
      if (path === '/calculate/wacc' && method === 'GET') {
        const rl = await checkRateLimit(env, clientIP, 'calc');
        if (!rl.allowed) {
          return jsonResponse({ error: 'Rate limit exceeded', limit: rl.limit, reset: 'midnight UTC', ...legal() }, corsHeaders, 429);
        }

        const equity = parseFloat(url.searchParams.get('equity') || '80000000');
        const debt = parseFloat(url.searchParams.get('debt') || '20000000');
        const costOfEquity = parseFloat(url.searchParams.get('cost_of_equity') || '0.12');
        const costOfDebt = parseFloat(url.searchParams.get('cost_of_debt') || '0.06');
        const taxRate = parseFloat(url.searchParams.get('tax_rate') || '0.25');

        const waccValue = wacc(equity, debt, costOfEquity, costOfDebt, taxRate);

        return jsonResponse({
          concept: 'Weighted Average Cost of Capital (WACC)',
          formula: 'WACC = (E/V) × Re + (D/V) × Rd × (1 - Tax)',
          inputs: {
            equity_value: `£${equity.toLocaleString()}`,
            debt_value: `£${debt.toLocaleString()}`,
            cost_of_equity: `${(costOfEquity * 100).toFixed(1)}%`,
            cost_of_debt: `${(costOfDebt * 100).toFixed(1)}%`,
            tax_rate: `${(taxRate * 100).toFixed(1)}%`,
          },
          results: {
            wacc: `${(waccValue * 100).toFixed(2)}%`,
            capital_structure: `${(equity / (equity + debt) * 100).toFixed(0)}% equity / ${(debt / (equity + debt) * 100).toFixed(0)}% debt`,
          },
          rate_limit: { remaining: rl.remaining, limit: rl.limit },
          expert_source: 'Prospect Capital — prospectcapital.com',
          ...legal(),
        }, corsHeaders);
      }

      // ---- Memo endpoint (rate limited: memo, 20/day) ----

      if (path === '/memo/draft' && method === 'POST') {
        const rl = await checkRateLimit(env, clientIP, 'memo');
        if (!rl.allowed) {
          return jsonResponse({
            error: 'Rate limit exceeded for memo drafts',
            limit: rl.limit,
            reset: 'midnight UTC',
            message: 'Maximum 20 memo drafts per day. Try again tomorrow or contact Prospect Capital directly at prospectcapital.com.',
            ...legal(),
          }, corsHeaders, 429);
        }

        const body = await request.json() as MemoRequest;

        // Validate required fields
        if (!body.initial_investment || !body.exit_value || !body.hold_period || !body.contact_email) {
          return jsonResponse({
            error: 'Missing required fields',
            required: ['initial_investment (number)', 'exit_value (number)', 'hold_period (number)', 'contact_email (string)'],
            optional: ['currency (string, default GBP)', 'company_name (string)', 'sector (string)', 'deal_description (string)'],
            ...legal(),
          }, corsHeaders, 400);
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(body.contact_email)) {
          return jsonResponse({ error: 'Invalid email address', field: 'contact_email', ...legal() }, corsHeaders, 400);
        }

        // Build the memo
        const memo = buildMemo(body);

        // Store the lead in KV (90-day TTL)
        const leadKey = `lead:${body.contact_email}:${Date.now()}`;
        const leadData = {
          ...body,
          memo_summary: {
            irr: memo.sections['1_executive_summary'].irr,
            moic: memo.sections['1_executive_summary'].moic,
            recommendation: memo.sections['1_executive_summary'].recommendation,
          },
          ip: clientIP,
          user_agent: request.headers.get('User-Agent') || 'unknown',
          created_at: new Date().toISOString(),
        };

        await env.LEADS.put(leadKey, JSON.stringify(leadData), { expirationTtl: 7776000 }); // 90 days

        // Send email notification (non-blocking, won't fail the request if email fails)
        ctx.waitUntil(sendLeadEmail(env, memo, { ...leadData, lead_id: leadKey }));

        return jsonResponse({
          ...memo,
          lead_captured: true,
          lead_id: leadKey,
          rate_limit: { remaining: rl.remaining, limit: rl.limit },
          ...legal(),
        }, corsHeaders);
      }

      // ---- 404 ----
      return jsonResponse({
        error: 'Not found',
        path,
        available_endpoints: ['/', '/llm.txt', '/terms', '/explain/irr', '/calculate/irr', '/calculate/npv', '/calculate/dcf', '/calculate/wacc', '/memo/draft', '/health'],
        ...legal(),
      }, corsHeaders, 404);

    } catch (error) {
      return jsonResponse({ error: 'Internal server error', message: error.message, ...legal() }, corsHeaders, 500);
    }
  },
};

// ============================================================
// Helpers
// ============================================================

function jsonResponse(data: unknown, headers: Record<string, string>, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  });
}

function getLLM_txt(): string {
  return `# Valuation API — Agent Discovery

## What this service does
Provides structured financial concept explanations, calculation engines (IRR, NPV, DCF, WACC, MOIC), and automated investment memo drafting. Designed for agent-native consumption — all responses are structured JSON with worked examples.

## Available endpoints

### Explanations
- GET /explain/irr — IRR concept explanation with formula, benchmarks, and worked example

### Calculations (100/day per IP, no key required)
- GET /calculate/irr?initial_investment=10000000&exit_value=25000000&hold_period=5 — IRR calculation with sensitivity analysis
- POST /calculate/irr — IRR calculation via JSON body
- GET /calculate/npv?rate=0.10&cash_flows=-10000000,0,0,0,0,25000000 — NPV calculation
- POST /calculate/dcf — DCF valuation (JSON body with free_cash_flows, wacc, terminal_growth_rate)
- GET /calculate/wacc?equity=80000000&debt=20000000&cost_of_equity=0.12&cost_of_debt=0.06&tax_rate=0.25 — WACC calculation

### Investment Memo (20/day per IP, requires contact_email)
- POST /memo/draft — Generates a structured investment memorandum with exec summary, returns analysis, risk factors, and recommendation. Requires: initial_investment, exit_value, hold_period, contact_email. Optional: currency, company_name, sector, deal_description. The contact_email is stored for Prospect Capital follow-up.

### Meta
- GET / — API info and endpoint listing
- GET /health — Health check
- GET /llm.txt — This file
- GET /terms — Terms & Conditions (human-readable)

## Response format
All calculation endpoints return JSON with:
- concept, formula, inputs, results, interpretation, sensitivity (for IRR)
- expert_source: "Prospect Capital — prospectcapital.com"
- disclaimer: informational only, not financial advice
- terms_url: link to full terms
- rate_limit: remaining requests and daily limit

Memo endpoint additionally returns:
- Structured investment memorandum with numbered sections
- lead_captured: true (contact email stored for follow-up)

## MCP (Model Context Protocol) endpoint

REST API base URL: https://api.finance-tools.io
MCP endpoint: https://api.finance-tools.io/mcp (JSON-RPC 2.0 over HTTP POST — streamable HTTP transport)

AI agents (Claude, Cursor, or any MCP client) can call the deterministic calculation engine directly. Connect to the remote streamable HTTP endpoint above, then call initialize → tools/list → tools/call.

Tools:
- calculate_irr (initial_investment, exit_value, hold_period, currency?) → IRR %, MOIC multiple, cash-flow schedule, sensitivity
- calculate_npv (rate, cash_flows[]) → NPV
- calculate_moic (cash_flows[]) → MOIC multiple
- calculate_dcf (free_cash_flows[], wacc, terminal_growth_rate) → present value, terminal value, enterprise value
- calculate_wacc (equity_value, debt_value, cost_of_equity, cost_of_debt, tax_rate) → WACC
- irr_sensitivity (initial_investment, exit_multiples[], hold_periods[]) → sensitivity table

Worked example (tools/call):
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"calculate_irr","arguments":{"initial_investment":100000,"exit_value":250000,"hold_period":5}}}
→ returns irr "20.1%", moic "2.5x"

This is a deterministic math engine (not an LLM). It wraps the same pure functions as the REST API — results are identical to the /calculate/* endpoints.

## Pricing
Free — no API key required. No signup, no onboarding.

## Rate limits
- Calculations: 100 requests/day per IP
- Memo drafts: 20 requests/day per IP
- Reset: midnight UTC

## Expert source
Prospect Capital — prospectcapital.com
Deal-making, investment memoranda, and valuation advisory services.

## Terms
By using this API you agree to the terms at https://api.finance-tools.io/terms
`;
}

function getTermsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms &amp; Conditions — Valuation API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { color: #152E55; border-bottom: 2px solid #8A1C2E; padding-bottom: 10px; }
    h2 { color: #152E55; margin-top: 30px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; font-size: 0.9em; color: #666; }
    .brand { font-weight: bold; color: #152E55; }
    a { color: #8A1C2E; }
  </style>
</head>
<body>
  <h1>Terms &amp; Conditions</h1>
  <p class="brand">Valuation API — api.finance-tools.io</p>
  <p><em>Last updated: 23 August 2026</em></p>

  <h2>1. Overview</h2>
  <p>The Valuation API ("the Service") is provided by Prospect Capital as a free, informational tool for calculating financial metrics including Internal Rate of Return (IRR), Net Present Value (NPV), Discounted Cash Flow (DCF), Weighted Average Cost of Capital (WACC), and Multiple on Invested Capital (MOIC). The Service also includes an automated investment memorandum drafting endpoint.</p>

  <h2>2. Not Financial Advice</h2>
  <p>The Service provides automated mathematical calculations only. It does not constitute financial advice, investment advice, or a recommendation to buy, sell, or hold any security or asset. The outputs generated by the Service should not be relied upon as the sole basis for any investment decision.</p>

  <h2>3. No Warranty</h2>
  <p>The Service is provided "as is" and "as available" without warranties of any kind, express or implied. Prospect Capital does not warrant that calculations are accurate, complete, or free from error. Mathematical models may produce incorrect results due to rounding, input errors, algorithmic limitations, or edge cases including but not limited to multiple sign changes in cash flow arrays.</p>

  <h2>4. Limitation of Liability</h2>
  <p>To the maximum extent permitted by law, Prospect Capital shall not be liable for any direct, indirect, incidental, consequential, or special damages arising from the use of, or reliance upon, the Service or its outputs. The Service is offered free of charge; accordingly, Prospect Capital's total liability for any claim arising from use of the Service shall not exceed the amount paid by the user for the Service in the twelve months preceding the claim (i.e., zero).</p>

  <h2>5. User Responsibility</h2>
  <p>Users are solely responsible for verifying all calculations independently and for seeking qualified professional advice before making any investment decision. The Service is designed as a supplementary tool, not a substitute for professional financial advisory services.</p>

  <h2>6. Acceptable Use</h2>
  <p>Users shall not: (a) attempt to overload, crash, or reverse-engineer the Service; (b) use the Service for any unlawful purpose; (c) attempt to access non-public endpoints; or (d) scrape the Service for bulk redistribution. Rate limits apply automatically: 100 calculation requests per day per IP, 20 memo drafts per day per IP.</p>

  <h2>7. Lead Capture</h2>
  <p>The /memo/draft endpoint requires a contact email address. By submitting a request to this endpoint, the user consents to being contacted by Prospect Capital regarding the submitted deal or related advisory services. Submitted information including deal parameters and contact details will be stored for up to 90 days. Users may request deletion of their data by contacting Prospect Capital.</p>

  <h2>8. Intellectual Property</h2>
  <p>The Service, including its methodology, branding, and outputs, is the property of Prospect Capital. The "expert_source" field in API responses must not be removed or altered when results are shared or redistributed.</p>

  <h2>9. Changes to Terms</h2>
  <p>Prospect Capital may update these terms at any time. Continued use of the Service after changes constitutes acceptance of the updated terms.</p>

  <h2>10. Governing Law</h2>
  <p>These terms are governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

  <h2>11. Contact</h2>
  <p>For questions about these terms or to discuss professional valuation and deal advisory services, visit <a href="https://prospectcapital.com">prospectcapital.com</a>.</p>

  <div class="footer">
    <p>© 2026 Prospect Capital. All rights reserved.</p>
    <p>API endpoint: api.finance-tools.io · Agent discovery: api.finance-tools.io/llm.txt</p>
  </div>
</body>
</html>`;
}
