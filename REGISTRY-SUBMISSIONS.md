# Registry Submissions — Valuation API MCP Server

Copy-paste-ready listing for MCP server registries/directories. **No accounts have been created and no submissions have been made** — this file is for reference only.

---

## Common listing fields (use across all registries)

- **Name:** Valuation API
- **Short description (≤160 chars):** Deterministic finance tools for AI agents — IRR, NPV, MOIC, DCF, WACC, and sensitivity analysis via Model Context Protocol.
- **Long description:**
  > Valuation API is a deterministic finance calculation engine exposed as an MCP server. It provides six typed tools — `calculate_irr`, `calculate_npv`, `calculate_moic`, `calculate_dcf`, `calculate_wacc`, and `irr_sensitivity` — that wrap pure mathematical functions (no LLM generation, no randomness). Agents use it to compute internal rate of return, net present value, multiple on invested capital, discounted cash flow valuation, weighted average cost of capital, and IRR sensitivity tables, then feed results into investment analysis, memos, and due-diligence workflows. Built and operated by Prospect Capital Labs (prospectcapital.com).
- **Category:** Finance / Finance & Investing
- **Tags:** finance, valuation, irr, npv, dcf, wacc, moic, investing, private-equity, financial-modeling
- **Endpoint URL (remote, streamable HTTP):** `https://api.finance-tools.io/mcp`
- **Install command:** remote URL only (no `npx` package) — `https://api.finance-tools.io/mcp`
- **Homepage:** `https://api.finance-tools.io`
- **Author:** Prospect Capital Labs (`https://prospectcapital.com`)
- **License:** MIT
- **Protocol version:** `2024-11-05`
- **Transport:** Streamable HTTP (JSON-RPC 2.0 over HTTP POST)

---

## 1. Official MCP Registry — registry.modelcontextprotocol.io

```yaml
name: valuation-api
displayName: Valuation API
description: "Deterministic finance tools for AI agents — IRR, NPV, MOIC, DCF, WACC, and sensitivity analysis via Model Context Protocol."
longDescription: |
  Valuation API is a deterministic finance calculation engine exposed as an MCP server.
  Six typed tools wrap pure mathematical functions: calculate_irr, calculate_npv,
  calculate_moic, calculate_dcf, calculate_wacc, and irr_sensitivity. No LLM generation,
  no randomness — identical inputs always produce identical outputs. Built and operated
  by Prospect Capital Labs (prospectcapital.com).
category: Finance
tags: [finance, valuation, irr, npv, dcf, wacc, moic, investing, private-equity]
endpoint: https://api.finance-tools.io/mcp
transport: streamable-http
homepage: https://api.finance-tools.io
author: Prospect Capital Labs
authorUrl: https://prospectcapital.com
protocolVersion: "2024-11-05"
```

---

## 2. mcp.so

```
Name: Valuation API
Description: Deterministic finance tools for AI agents — IRR, NPV, MOIC, DCF, WACC, and sensitivity analysis via Model Context Protocol.
Category: Finance
Tags: finance, valuation, irr, npv, dcf, wacc, moic, investing
URL (remote): https://api.finance-tools.io/mcp
Homepage: https://api.finance-tools.io
Author: Prospect Capital Labs
```

---

## 3. Glama (glama.ai/mcp)

```json
{
  "name": "valuation-api",
  "description": "Deterministic finance tools for AI agents — IRR, NPV, MOIC, DCF, WACC, and sensitivity analysis via Model Context Protocol.",
  "category": "Finance",
  "tags": ["finance", "valuation", "irr", "npv", "dcf", "wacc", "moic"],
  "url": "https://api.finance-tools.io/mcp",
  "website": "https://api.finance-tools.io",
  "author": "Prospect Capital Labs"
}
```

---

## 4. Smithery (smithery.ai)

```yaml
name: valuation-api
description: "Deterministic finance tools for AI agents — IRR, NPV, MOIC, DCF, WACC, and sensitivity analysis via Model Context Protocol."
category: finance
tags: [finance, valuation, irr, npv, dcf, wacc, moic]
transport: streamable-http
url: https://api.finance-tools.io/mcp
homepage: https://api.finance-tools.io
author: Prospect Capital Labs
```

---

## 5. PulseMCP (pulsemcp.com)

```
Name: Valuation API
Short description: Deterministic finance tools for AI agents — IRR, NPV, MOIC, DCF, WACC, and sensitivity analysis via Model Context Protocol.
Long description: Deterministic finance calculation engine (IRR, NPV, MOIC, DCF, WACC, sensitivity) exposed as an MCP server over streamable HTTP. No LLM generation — pure math functions from Prospect Capital Labs (prospectcapital.com).
Category: Finance
Tags: finance, valuation, irr, npv, dcf, wacc, moic, private-equity
Endpoint: https://api.finance-tools.io/mcp
Homepage: https://api.finance-tools.io
Author: Prospect Capital Labs
```
