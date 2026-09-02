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

const SERVER_NAME = 'valuation-api';
const SERVER_VERSION = '0.3.0';
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

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'calculate_irr',
    description:
      'Calculate the Internal Rate of Return (IRR), MOIC, and a full sensitivity table for a single equity investment given the initial investment, exit value, and hold period in years. Use this when you need the annualized return of a lump-sum investment that returns a single exit value after N years. Returns the IRR percentage, MOIC multiple, cash-flow schedule, plain-language interpretation, and IRR sensitivity across exit multiples and hold periods.',
    inputSchema: {
      type: 'object',
      properties: {
        initial_investment: {
          type: 'number',
          description: 'Amount invested up front (positive number), e.g. 100000',
        },
        exit_value: {
          type: 'number',
          description: 'Value returned at exit (positive number), e.g. 250000',
        },
        hold_period: {
          type: 'integer',
          description: 'Holding period in whole years, e.g. 5',
        },
        currency: {
          type: 'string',
          description: 'Optional currency code (GBP, USD, EUR, JPY, CHF). Defaults to GBP.',
        },
      },
      required: ['initial_investment', 'exit_value', 'hold_period'],
    },
  },
  {
    name: 'calculate_npv',
    description:
      'Calculate the Net Present Value (NPV) of a series of cash flows discounted at a given rate. Use this to evaluate whether an investment creates or destroys value at a specified discount rate. The first cash flow is typically the negative initial investment at time 0, followed by future cash flows. Returns the NPV as a single number (rounded to 2 decimals).',
    inputSchema: {
      type: 'object',
      properties: {
        rate: {
          type: 'number',
          description: 'Discount rate as a decimal, e.g. 0.10 for 10%',
        },
        cash_flows: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Ordered cash flows starting at time 0, e.g. [-100000, 0, 0, 0, 0, 250000]',
        },
      },
      required: ['rate', 'cash_flows'],
    },
  },
  {
    name: 'calculate_moic',
    description:
      'Calculate the Multiple on Invested Capital (MOIC) from a cash-flow schedule. MOIC equals total distributions divided by total invested. Use this for a quick money-multiple answer without needing a discount rate. Returns the MOIC multiple (e.g. 2.5x).',
    inputSchema: {
      type: 'object',
      properties: {
        cash_flows: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Ordered cash flows starting at time 0 (negatives are investments, positives are distributions), e.g. [-100000, 0, 0, 0, 0, 250000]',
        },
      },
      required: ['cash_flows'],
    },
  },
  {
    name: 'calculate_dcf',
    description:
      'Compute a Discounted Cash Flow (DCF) valuation: the enterprise value from explicit projected free cash flows plus a terminal value (Gordon Growth Model). Use this to value a company or asset from its projected free cash flows, WACC, and perpetual terminal growth rate. Returns present value, terminal value, and enterprise value (rounded to 2 decimals).',
    inputSchema: {
      type: 'object',
      properties: {
        free_cash_flows: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Projected free cash flows per period, e.g. [5000000, 6000000, 7000000, 8000000, 9000000]',
        },
        wacc: {
          type: 'number',
          description: 'Weighted average cost of capital as a decimal, e.g. 0.10',
        },
        terminal_growth_rate: {
          type: 'number',
          description:
            'Perpetual growth rate as a decimal, e.g. 0.03 (must be less than wacc)',
        },
      },
      required: ['free_cash_flows', 'wacc', 'terminal_growth_rate'],
    },
  },
  {
    name: 'calculate_wacc',
    description:
      'Calculate the Weighted Average Cost of Capital (WACC) given equity value, debt value, cost of equity, cost of debt, and tax rate. Use this to determine the discount rate for DCF valuation. Returns the WACC as a decimal (e.g. 0.105) and as a percentage.',
    inputSchema: {
      type: 'object',
      properties: {
        equity_value: { type: 'number', description: 'Market value of equity' },
        debt_value: { type: 'number', description: 'Market value of debt' },
        cost_of_equity: {
          type: 'number',
          description: 'Cost of equity as a decimal, e.g. 0.12',
        },
        cost_of_debt: {
          type: 'number',
          description: 'Cost of debt as a decimal, e.g. 0.06',
        },
        tax_rate: {
          type: 'number',
          description: 'Corporate tax rate as a decimal, e.g. 0.25',
        },
      },
      required: ['equity_value', 'debt_value', 'cost_of_equity', 'cost_of_debt', 'tax_rate'],
    },
  },
  {
    name: 'irr_sensitivity',
    description:
      'Compute IRR sensitivity across a range of exit multiples and hold periods for a single investment. Use this to stress-test returns before committing to an investment. Returns IRR percentages organized by exit multiple (byMultiple) and by hold period in years (byHoldPeriod).',
    inputSchema: {
      type: 'object',
      properties: {
        initial_investment: {
          type: 'number',
          description: 'Amount invested up front (positive number)',
        },
        exit_multiples: {
          type: 'array',
          items: { type: 'number' },
          description: 'Exit multiples to test, e.g. [2.0, 2.5, 3.0, 4.0, 5.0]',
        },
        hold_periods: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Hold periods in years to test, e.g. [3, 5, 7, 10]',
        },
      },
      required: ['initial_investment'],
    },
  },
];

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

    default:
      return jsonRpcError(id, -32602, 'Invalid params', `Unknown tool: ${name}`);
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
        return jsonRpcResult(id, { tools: TOOLS });

      case 'tools/call':
        return handleToolCall(id, body.params);

      default:
        return jsonRpcError(id, -32601, 'Method not found', `Unknown method: ${method}`);
    }
  } catch (e) {
    return jsonRpcError(id, -32603, 'Internal error', e instanceof Error ? e.message : String(e));
  }
}
