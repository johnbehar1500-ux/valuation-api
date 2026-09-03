/**
 * MCP (Model Context Protocol) server — hand-rolled streamable HTTP transport.
 *
 * JSON-RPC 2.0 over HTTP POST at /mcp.
 * Wraps the SAME pure functions from ./calculate — no duplicated math.
 *
 * Supported methods:
 *   initialize               → protocolVersion + capabilities { tools: {} } + serverInfo
 *   notifications/initialized → notification (no response, HTTP 202)
 *   tools/list               → the 6 tools with JSON Schema inputSchema
 *   tools/call               → dispatch to calculate.ts, return content:[{type:"text", text:JSON}]
 *   ping                     → {}
 *
 * Non-POST methods get 405 with Allow: POST. OPTIONS is handled for CORS preflight.
 */

import {
  npv,
  moic,
  dcf,
  wacc,
  irrSensitivity,
  buildIRRResponse,
} from './calculate';
import { RATIO_TOOLS, runRatioTool } from './ratioTools';
import { ADVANCED_TOOLS, runAdvancedTool } from './advancedTools';

const SERVER_NAME = 'valuation-api';
const SERVER_VERSION = '0.6.0';
const PROTOCOL_VERSION = '2024-11-05';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Max-Age': '86400',
};

function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// ============================================================
// Tool definitions (JSON Schema inputSchema)
// ============================================================

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

// All valuation-api tools are pure deterministic functions: read-only, no
// side effects, no network/storage access, idempotent, closed-world.
const PURE_FN_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const TOOLS: ToolDef[] = [
  {
    name: 'calculate_irr',
    description:
      'Calculate the Internal Rate of Return (IRR), MOIC and an IRR sensitivity table for a single lump-sum equity investment that returns one exit value after a whole-year hold period. ' +
      'WHEN TO USE: you have an upfront investment amount, a single exit value and a hold period in whole years (standard PE/VC single-exit scenario) and need the annualised return, the money multiple, or a return stress-test. The result also includes a plain-language interpretation benchmarked against VC/PE/public-market return hurdles. ' +
      'WHEN NOT TO USE: for cash-flow streams with multiple intermediate distributions (use calculate_npv or calculate_moic on the full cash-flow array), or when you only need the sensitivity grid (use irr_sensitivity). ' +
      'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access, no randomness; idempotent and non-destructive; identical inputs always produce identical outputs. IRR is solved over the cash-flow schedule [-investment, 0, ..., exit_value] via Newton-Raphson with bisection fallback. ' +
      'RETURNS: JSON object with concept, definition, formula, calculation (irr as a percentage string, moic as a multiple, cash_flows array), interpretation, and sensitivity (byMultiple, byHoldPeriod). ' +
      'PARAMETERS: initial_investment (number > 0, currency units), exit_value (number > 0, same currency units), hold_period (integer >= 1 whole years), currency (optional string: GBP default, USD, EUR, JPY, CHF — display only, no conversion).',
    inputSchema: {
      type: 'object',
      properties: {
        initial_investment: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Amount invested up front, in currency units, e.g. 100000. Must be positive.',
        },
        exit_value: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Value returned at exit, same currency units as initial_investment, e.g. 250000. Must be positive.',
        },
        hold_period: {
          type: 'integer',
          minimum: 1,
          description: 'Holding period in whole years, e.g. 5. Must be a positive integer (1, 2, 3, ...).',
        },
        currency: {
          type: 'string',
          enum: ['GBP', 'USD', 'EUR', 'JPY', 'CHF'],
          default: 'GBP',
          description: 'Optional display currency code. Defaults to GBP. Used only for formatting output labels — no FX conversion is performed.',
        },
      },
      required: ['initial_investment', 'exit_value', 'hold_period'],
    },
    annotations: PURE_FN_ANNOTATIONS,
  },
  {
    name: 'calculate_npv',
    description:
      'Calculate the Net Present Value (NPV) of an ordered cash-flow series discounted at a given rate. The first cash flow is treated as time 0 and is NOT discounted (typically the negative initial investment). ' +
      'WHEN TO USE: to evaluate whether an investment creates or destroys value at a required discount rate, or to compare competing projects on a present-value basis when you have a full cash-flow schedule. ' +
      'WHEN NOT TO USE: for a single lump-sum investment with one exit value (use calculate_irr), or when you only need a money multiple with no time value (use calculate_moic). ' +
      'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; idempotent and non-destructive; identical inputs always produce identical outputs. ' +
      'RETURNS: JSON object { npv: number rounded to 2dp, rate, cash_flows }. A positive NPV means the investment clears the discount-rate hurdle. ' +
      'PARAMETERS: rate (decimal discount rate, e.g. 0.10 = 10% — express as a decimal, never as percentage points), cash_flows (ordered number array starting at time 0; negative values are investments/outflows, positive values are distributions/inflows), e.g. [-100000, 0, 0, 0, 0, 250000].',
    inputSchema: {
      type: 'object',
      properties: {
        rate: {
          type: 'number',
          description: 'Discount rate as a decimal, e.g. 0.10 = 10%. Never pass percentage points (10 is invalid for 10%).',
        },
        cash_flows: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
          description: 'Ordered cash flows starting at time 0 (first element is not discounted). Negative = investment/outflow, positive = distribution/inflow. Example: [-100000, 0, 0, 0, 0, 250000].',
        },
      },
      required: ['rate', 'cash_flows'],
    },
    annotations: PURE_FN_ANNOTATIONS,
  },
  {
    name: 'calculate_moic',
    description:
      'Calculate the Multiple on Invested Capital (MOIC): total distributions divided by total invested, with no discounting and no time value. ' +
      'WHEN TO USE: for a quick money-multiple answer from a cash-flow schedule when you do not need a discount rate or annualised return. ' +
      'WHEN NOT TO USE: when time value of money matters (use calculate_irr for annualised return, or calculate_npv for discounted value). ' +
      'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; idempotent and non-destructive. MOIC is computed as sum of positive cash flows divided by sum of absolute negative cash flows; returns 0 if there is no invested capital. ' +
      'RETURNS: JSON object { moic: number rounded to 2dp (e.g. 2.5 = 2.5x), cash_flows }. ' +
      'PARAMETERS: cash_flows (ordered number array starting at time 0; negatives are investments, positives are distributions), e.g. [-100000, 0, 0, 0, 0, 250000].',
    inputSchema: {
      type: 'object',
      properties: {
        cash_flows: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
          description: 'Ordered cash flows starting at time 0. Negative = invested capital, positive = distributions. Example: [-100000, 0, 0, 0, 0, 250000].',
        },
      },
      required: ['cash_flows'],
    },
    annotations: PURE_FN_ANNOTATIONS,
  },
  {
    name: 'calculate_dcf',
    description:
      'Compute a Discounted Cash Flow (DCF) valuation: enterprise value from projected free cash flows plus a Gordon-growth terminal value. ' +
      'WHEN TO USE: to value a company or asset from its projected free cash flows, WACC and perpetual terminal growth rate (standard corporate/asset valuation). ' +
      'WHEN NOT TO USE: for a single-exit lump-sum investment (use calculate_irr), or when you need the discount rate itself (use calculate_wacc). ' +
      'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; idempotent and non-destructive. Terminal value uses the Gordon Growth Model; it is only defined when wacc is strictly greater than terminal_growth_rate. ' +
      'RETURNS: JSON object { inputs, results: { present_value, terminal_value, enterprise_value } }, each rounded to 2dp. present_value is the discounted explicit-period FCFs; enterprise_value = present_value + discounted terminal value (debt and cash are NOT netted — this is enterprise value, not equity value). ' +
      'PARAMETERS: free_cash_flows (array of per-period projected free cash flows, typically positive; the first element is discounted by one period), wacc (decimal, e.g. 0.10 = 10% — never pass percentage points; must be > terminal_growth_rate), terminal_growth_rate (decimal perpetual growth rate, e.g. 0.03 = 3% — never pass percentage points; must be < wacc).',
    inputSchema: {
      type: 'object',
      properties: {
        free_cash_flows: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
          description: 'Projected free cash flows per period, e.g. [5000000, 6000000, 7000000, 8000000, 9000000]. Typically positive; first element discounted one period.',
        },
        wacc: {
          type: 'number',
          description: 'Weighted average cost of capital as a decimal, e.g. 0.10 = 10% (never pass percentage points). Must be strictly greater than terminal_growth_rate.',
        },
        terminal_growth_rate: {
          type: 'number',
          description: 'Perpetual terminal growth rate as a decimal, e.g. 0.03 = 3% (never pass percentage points). Must be strictly less than wacc, otherwise terminal value is undefined.',
        },
      },
      required: ['free_cash_flows', 'wacc', 'terminal_growth_rate'],
    },
    annotations: PURE_FN_ANNOTATIONS,
  },
  {
    name: 'calculate_wacc',
    description:
      'Calculate the Weighted Average Cost of Capital (WACC): the blended after-tax cost of a company\'s equity and debt capital, weighted by market values. ' +
      'WHEN TO USE: to determine the discount rate for a DCF valuation from equity market value, debt market value, costs of capital and corporate tax rate. ' +
      'WHEN NOT TO USE: when you already have the discount rate, or for the full valuation itself (use calculate_dcf). ' +
      'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; idempotent and non-destructive. Formula: (E/V) x Re + (D/V) x Rd x (1 - tax_rate), where V = equity_value + debt_value; returns 0 if total value is 0. ' +
      'RETURNS: JSON object { wacc: decimal rounded to 6dp (e.g. 0.105), wacc_percent: percentage rounded to 2dp (e.g. 10.5), inputs }. ' +
      'PARAMETERS: equity_value (market value of equity, >= 0), debt_value (market value of debt, >= 0), cost_of_equity (decimal, e.g. 0.12 = 12%), cost_of_debt (decimal, e.g. 0.06 = 6%), tax_rate (decimal 0-1, e.g. 0.25 = 25%). All rates are decimals, never percentage points.',
    inputSchema: {
      type: 'object',
      properties: {
        equity_value: { type: 'number', minimum: 0, description: 'Market value of equity, >= 0, e.g. 10000000.' },
        debt_value: { type: 'number', minimum: 0, description: 'Market value of debt, >= 0, e.g. 5000000.' },
        cost_of_equity: { type: 'number', description: 'Cost of equity as a decimal, e.g. 0.12 = 12%. Never pass percentage points.' },
        cost_of_debt: { type: 'number', description: 'Cost of debt as a decimal, e.g. 0.06 = 6%. Never pass percentage points.' },
        tax_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Corporate tax rate as a decimal between 0 and 1, e.g. 0.25 = 25%.' },
      },
      required: ['equity_value', 'debt_value', 'cost_of_equity', 'cost_of_debt', 'tax_rate'],
    },
    annotations: PURE_FN_ANNOTATIONS,
  },
  {
    name: 'irr_sensitivity',
    description:
      'Compute an IRR sensitivity grid across a range of exit multiples and hold periods for a single lump-sum investment. ' +
      'WHEN TO USE: to stress-test how the annualised return varies with exit multiple and holding period before committing to an investment. Complements calculate_irr. ' +
      'WHEN NOT TO USE: when you need one precise IRR for a known exit value (use calculate_irr), or a full valuation (use calculate_dcf). ' +
      'BEHAVIOUR: pure deterministic calculation — no side effects, no network or storage access; idempotent and non-destructive. NOTE ON GRID GEOMETRY: the byMultiple grid is computed at the SECOND hold period in hold_periods (default 5 years); the byHoldPeriod grid is computed at a 2.5x exit multiple. ' +
      'RETURNS: JSON object { byMultiple: { "2.0x": 14.9, ... } with IRR values as percentage numbers rounded to 1dp, byHoldPeriod: { "5y": 18.4, ... } }. ' +
      'PARAMETERS: initial_investment (number > 0), exit_multiples (optional array of numbers to test, default [1.5, 2.0, 2.5, 3.0, 3.5]), hold_periods (optional array of positive integers (years) to test, default [3, 5, 7, 10]).',
    inputSchema: {
      type: 'object',
      properties: {
        initial_investment: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Amount invested up front, in currency units, e.g. 100000. Must be positive.',
        },
        exit_multiples: {
          type: 'array',
          items: { type: 'number' },
          description: 'Exit multiples to test, e.g. [2.0, 2.5, 3.0, 4.0, 5.0]. Defaults to [1.5, 2.0, 2.5, 3.0, 3.5].',
        },
        hold_periods: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: 'Hold periods in whole years to test, e.g. [3, 5, 7, 10]. Defaults to [3, 5, 7, 10].',
        },
      },
      required: ['initial_investment'],
    },
    annotations: PURE_FN_ANNOTATIONS,
  },
];

const ALL_TOOLS: ToolDef[] = [...TOOLS, ...RATIO_TOOLS, ...ADVANCED_TOOLS];

// ============================================================
// JSON-RPC helpers
// ============================================================

function jsonRpcResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown
): Response {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ============================================================
// Tool dispatch
// ============================================================

function invalidParams(id: unknown, msg: string): Response {
  return jsonRpcError(id, -32602, 'Invalid params', msg);
}

function handleToolCall(id: unknown, params: unknown): Response {
  const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  const name = p.name;
  const args = p.arguments ?? {};

  if (!name) {
    return invalidParams(id, 'Missing tool name in params.name');
  }

  switch (name) {
    case 'calculate_irr': {
      const { initial_investment, exit_value, hold_period, currency } = args;
      if (
        typeof initial_investment !== 'number' ||
        typeof exit_value !== 'number' ||
        typeof hold_period !== 'number'
      ) {
        return invalidParams(
          id,
          'calculate_irr requires numeric initial_investment, exit_value, and hold_period'
        );
      }
      const result = buildIRRResponse({
        initial_investment,
        exit_value,
        hold_period,
        currency: typeof currency === 'string' ? currency : undefined,
      });
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    }

    case 'calculate_npv': {
      const { rate, cash_flows } = args;
      if (typeof rate !== 'number' || !Array.isArray(cash_flows)) {
        return invalidParams(
          id,
          'calculate_npv requires numeric rate and a cash_flows array of numbers'
        );
      }
      const flows = cash_flows.map(Number);
      const value = npv(rate, flows);
      return jsonRpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ npv: round(value, 2), rate, cash_flows: flows }),
          },
        ],
      });
    }

    case 'calculate_moic': {
      const { cash_flows } = args;
      if (!Array.isArray(cash_flows)) {
        return invalidParams(id, 'calculate_moic requires a cash_flows array of numbers');
      }
      const flows = cash_flows.map(Number);
      return jsonRpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ moic: round(moic(flows), 2), cash_flows: flows }),
          },
        ],
      });
    }

    case 'calculate_dcf': {
      const { free_cash_flows, wacc: w, terminal_growth_rate } = args;
      if (
        !Array.isArray(free_cash_flows) ||
        typeof w !== 'number' ||
        typeof terminal_growth_rate !== 'number'
      ) {
        return invalidParams(
          id,
          'calculate_dcf requires free_cash_flows (array), wacc, and terminal_growth_rate'
        );
      }
      const flows = free_cash_flows.map(Number);
      const r = dcf(flows, w, terminal_growth_rate);
      return jsonRpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              inputs: { free_cash_flows: flows, wacc: w, terminal_growth_rate },
              results: {
                present_value: r.presentValue,
                terminal_value: r.terminalValue,
                enterprise_value: r.enterpriseValue,
              },
            }),
          },
        ],
      });
    }

    case 'calculate_wacc': {
      const { equity_value, debt_value, cost_of_equity, cost_of_debt, tax_rate } = args;
      if (
        typeof equity_value !== 'number' ||
        typeof debt_value !== 'number' ||
        typeof cost_of_equity !== 'number' ||
        typeof cost_of_debt !== 'number' ||
        typeof tax_rate !== 'number'
      ) {
        return invalidParams(
          id,
          'calculate_wacc requires numeric equity_value, debt_value, cost_of_equity, cost_of_debt, and tax_rate'
        );
      }
      const value = wacc(equity_value, debt_value, cost_of_equity, cost_of_debt, tax_rate);
      return jsonRpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              wacc: round(value, 6),
              wacc_percent: round(value * 100, 2),
              inputs: { equity_value, debt_value, cost_of_equity, cost_of_debt, tax_rate },
            }),
          },
        ],
      });
    }

    case 'irr_sensitivity': {
      const { initial_investment, exit_multiples, hold_periods } = args;
      if (typeof initial_investment !== 'number') {
        return invalidParams(id, 'irr_sensitivity requires numeric initial_investment');
      }
      const result = irrSensitivity(
        initial_investment,
        Array.isArray(exit_multiples) ? exit_multiples.map(Number) : undefined,
        Array.isArray(hold_periods) ? hold_periods.map(Number) : undefined
      );
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    }

    default: {
      // Financial ratio family (Phase 1) — dispatched from ratioTools.ts
      const ratio = runRatioTool(name, args);
      if (ratio) {
        if (!ratio.ok) return invalidParams(id, ratio.error);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(ratio.value) }],
        });
      }
      // TVM / valuation-depth family (Phase 2) — dispatched from advancedTools.ts
      const advanced = runAdvancedTool(name, args);
      if (advanced) {
        if (!advanced.ok) return invalidParams(id, advanced.error);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(advanced.value) }],
        });
      }
      return jsonRpcError(id, -32602, 'Invalid params', `Unknown tool: ${name}`);
    }
  }
}

// ============================================================
// Main handler
// ============================================================

export async function handleMcp(request: Request): Promise<Response> {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Only POST is supported by this transport
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST' },
    });
  }

  let body: { id?: unknown; method?: string; params?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; method?: string; params?: unknown };
  } catch {
    return jsonRpcError(null, -32700, 'Parse error', 'Request body is not valid JSON');
  }

  const id = body.id;
  const method = body.method;

  // Notifications (no id) → no JSON-RPC response, return HTTP 202
  if (id === undefined || id === null) {
    // e.g. notifications/initialized
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  try {
    switch (method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });

      case 'ping':
        return jsonRpcResult(id, {});

      case 'tools/list':
        return jsonRpcResult(id, { tools: ALL_TOOLS });

      case 'tools/call':
        return handleToolCall(id, body.params);

      default:
        return jsonRpcError(id, -32601, 'Method not found', `Unknown method: ${method}`);
    }
  } catch (e) {
    return jsonRpcError(id, -32603, 'Internal error', e instanceof Error ? e.message : String(e));
  }
}
