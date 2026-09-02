# Valuation API — MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server exposing the deterministic finance calculation engine behind [valuation-api](https://api.finance-tools.io) as native tools for AI agents.

## What it is

A hand-rolled, zero-dependency MCP server using the **streamable HTTP transport** (JSON-RPC 2.0 over HTTP POST). It wraps the exact same pure functions (`npv`, `irr`, `moic`, `dcf`, `wacc`, `irrSensitivity`, `buildIRRResponse`) that power the REST API — no duplicated math, identical results.

## Endpoint

- **MCP endpoint (streamable HTTP):** `https://api.finance-tools.io/mcp`
- **REST API base URL:** `https://api.finance-tools.io`
- **Transport:** JSON-RPC 2.0 over HTTP POST (stateless; no sessions required)
- **Protocol version:** `2024-11-05`

## How to connect

### Any MCP client (remote streamable HTTP)

Point your MCP client at `https://api.finance-tools.io/mcp` as a remote streamable HTTP server. The standard handshake is `initialize` → `tools/list` → `tools/call`.

### Claude Desktop / clients with a `mcpServers` map

```json
{
  "mcpServers": {
    "valuation-api": {
      "type": "http",
      "url": "https://api.finance-tools.io/mcp"
    }
  }
}
```

> Depending on your client version, the field may be `"url"` (SSE-style) or `"type": "http"` (streamable HTTP). This server uses **streamable HTTP**; it is remote-only (no `npx` package to install). If your client only supports stdio, run a streamable-HTTP→stdio bridge locally (e.g. the MCP Inspector's proxy) against the URL above.

### Manual (curl)

```bash
# 1. initialize
curl -s -X POST https://api.finance-tools.io/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# 2. tools/list
curl -s -X POST https://api.finance-tools.io/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. tools/call
curl -s -X POST https://api.finance-tools.io/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"calculate_irr","arguments":{"initial_investment":100000,"exit_value":250000,"hold_period":5}}}'
```

## Tools

| Tool | Inputs | Returns |
|------|--------|---------|
| `calculate_irr` | `initial_investment`, `exit_value`, `hold_period`, `currency?` | IRR %, MOIC multiple, cash-flow schedule, interpretation, sensitivity |
| `calculate_npv` | `rate`, `cash_flows[]` | NPV |
| `calculate_moic` | `cash_flows[]` | MOIC multiple |
| `calculate_dcf` | `free_cash_flows[]`, `wacc`, `terminal_growth_rate` | present value, terminal value, enterprise value |
| `calculate_wacc` | `equity_value`, `debt_value`, `cost_of_equity`, `cost_of_debt`, `tax_rate` | WACC (decimal + %) |
| `irr_sensitivity` | `initial_investment`, `exit_multiples[]?`, `hold_periods[]?` | IRR sensitivity table |

## Worked example

`calculate_irr` with `initial_investment=100000`, `exit_value=250000`, `hold_period=5`:

```json
{
  "concept": "Internal Rate of Return (IRR)",
  "calculation": {
    "initial_investment": "£100,000",
    "exit_value": "£250,000",
    "hold_period": "5 years",
    "irr": "20.1%",
    "moic": "2.5x",
    "cash_flows": [-100000, 0, 0, 0, 0, 250000]
  },
  "sensitivity": {
    "byMultiple": { "1.5x": 8.4, "2x": 14.9, "2.5x": 20.1, "3x": 24.6, "3.5x": 28.5 },
    "byHoldPeriod": { "3y": 35.7, "5y": 20.1, "7y": 14.0, "10y": 9.6 }
  }
}
```

## Deterministic engine

This is a deterministic math engine, not an LLM. Every tool result is computed from the inputs via pure functions; identical inputs always produce identical outputs. No generated prose, no randomness.

## Disclaimer

Informational only, not financial advice. Verify independently before making investment decisions. See https://api.finance-tools.io/terms.
